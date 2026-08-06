import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { AiChatRequest, AiProvider } from '../src/ai/ai-provider.service';
import { EmbeddingService } from '../src/ai/embedding.service';
import { AppModule } from '../src/app.module';
import { WechatService } from '../src/auth/wechat.service';
import { migrationDataSourceOptions } from '../src/database/database-options';
import { BibliographicRecord, ReadingGrade } from '../src/bibliographic-records/bibliographic-record.entity';
import { Copy, CopyStatus } from '../src/copies/copy.entity';
import { Reader } from '../src/readers/reader.entity';
import { Permission, Staff, StaffRole } from '../src/staff/staff.entity';

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';

/** 与 migration(vector(768)) 维度一致的非零确定向量 */
const FIXED_VECTOR = Array.from({ length: 768 }, (_, i) => (i === 7 ? 1 : 0));

class FakeWechatService implements WechatService {
  constructor(private readonly openidByCode: Map<string, string>) {}

  async exchangeCode(code: string) {
    const openid = this.openidByCode.get(code);
    if (!openid) {
      throw new Error(`unknown code: ${code}`);
    }
    return { openid, unionid: null };
  }
}

/** 仅替换 AiProvider：意图解析与标签建议的真实实现均依赖此接缝，从而确定性离线可测（AC4） */
class FakeAiProvider implements AiProvider {
  chatHandler: (request: AiChatRequest) => Promise<string | null> = () => Promise.resolve(null);
  embedHandler: (text: string) => Promise<number[] | null> = () => Promise.resolve(null);

  chat(request: AiChatRequest): Promise<string | null> {
    return this.chatHandler(request);
  }

  embed(text: string): Promise<number[] | null> {
    return this.embedHandler(text);
  }
}

describe('natural language search + pluggable AI provider (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let fakeProvider: FakeAiProvider;
  const openidByCode = new Map<string, string>();

  const host = process.env.DB_HOST ?? 'localhost';
  const port = parseInt(process.env.DB_PORT ?? '5433', 10);
  const username = process.env.DB_USER ?? 'library';
  const password = process.env.DB_PASSWORD ?? 'library';

  async function ensureTestDatabase(): Promise<void> {
    const bootstrap = new DataSource({
      type: 'postgres',
      host,
      port,
      username,
      password,
      database: 'postgres',
      synchronize: false,
    });
    await bootstrap.initialize();
    try {
      await bootstrap.query('CREATE DATABASE library_test');
    } catch (error) {
      const err = error as Error;
      if (!/already exists/.test(err.message)) {
        throw error;
      }
    } finally {
      await bootstrap.destroy();
    }
  }

  async function seedLibrarian(permissions: Permission[]): Promise<Staff> {
    const repo = dataSource.getRepository(Staff);
    const staff = repo.create({
      username: `nl-librarian-${Date.now()}-${Math.random()}`,
      passwordHash: await bcrypt.hash('librarian-password-1', 10),
      role: StaffRole.Librarian,
      permissions,
    });
    return repo.save(staff);
  }

  async function seedReader(): Promise<Reader> {
    const repo = dataSource.getRepository(Reader);
    const reader = repo.create({
      cardNumber: `READER-NATURAL-${Date.now()}`,
      name: '自然语言读者',
      readerType: 'student',
      passwordHash: await bcrypt.hash('reader-password-1', 10),
    });
    return repo.save(reader);
  }

  async function staffToken(staff: Staff): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/staff/login')
      .send({ username: staff.username, password: 'librarian-password-1' })
      .expect(200);
    return (res.body as { token: string }).token;
  }

  async function readerToken(): Promise<string> {
    const reader = await seedReader();
    const code = `reader-natural-code-${Date.now()}`;
    openidByCode.set(code, `reader-natural-openid-${Date.now()}`);
    await request(app.getHttpServer())
      .post('/auth/bind')
      .send({ code, cardNumber: reader.cardNumber, password: 'reader-password-1' })
      .expect(200);
    const login = await request(app.getHttpServer())
      .post('/auth/wechat/login')
      .send({ code })
      .expect(200);
    return (login.body as { token: string }).token;
  }

  async function seedRecord(
    title: string,
    opts?: { readingGrade?: ReadingGrade; subjects?: string[]; withCopy?: boolean },
  ): Promise<BibliographicRecord> {
    const repo = dataSource.getRepository(BibliographicRecord);
    const record = await repo.save(
      repo.create({
        title,
        readingGrade: opts?.readingGrade ?? null,
        subjects: opts?.subjects ?? null,
      }),
    );
    if (opts?.withCopy) {
      await dataSource.getRepository(Copy).save(
        dataSource.getRepository(Copy).create({
          barcode: `BC-${Date.now()}-${Math.random()}`,
          status: CopyStatus.Available,
          bibliographicRecordId: record.id,
        }),
      );
    }
    return record;
  }

  beforeAll(async () => {
    await ensureTestDatabase();
    dataSource = new DataSource(migrationDataSourceOptions(process.env));
    await dataSource.initialize();
    await dataSource.runMigrations();
    await dataSource.query(
      'TRUNCATE "reader", "staff", "bibliographic_record", "copy" RESTART IDENTITY CASCADE',
    );

    fakeProvider = new FakeAiProvider();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WechatService)
      .useValue(new FakeWechatService(openidByCode))
      .overrideProvider(AiProvider)
      .useValue(fakeProvider)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await dataSource?.destroy();
  });

  describe('AC-1 AI Provider 可插拔：仅覆盖 Provider，阅读标签建议经其实时生效', () => {
    it('标签建议通过 FakeAiProvider 返回（真实建议器消费同一接缝）', async () => {
      fakeProvider.chatHandler = () =>
        Promise.resolve(JSON.stringify({ readingGrade: ReadingGrade.Middle, subjects: ['数学', '科普'] }));
      const librarian = await seedLibrarian([Permission.Cataloging]);
      const token = await staffToken(librarian);
      const record = await seedRecord('代数入门');

      const res = await request(app.getHttpServer())
        .post(`/bibliographic-records/${record.id}/reading-tags/suggest`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toMatchObject({
        readingGrade: ReadingGrade.Middle,
        subjects: ['数学', '科普'],
      });
    });
  });

  describe('AC-2 自然语言查询被解析为结构化条件（学科/年级/状态）', () => {
    it('「初中数学」→ 结构化过滤：仅返回初中 + 数学 + 在馆的书，并附理由', async () => {
      const hit = await seedRecord('初中数学练习', {
        readingGrade: ReadingGrade.Middle,
        subjects: ['数学'],
        withCopy: true,
      });
      await seedRecord('高中物理', {
        readingGrade: ReadingGrade.Senior,
        subjects: ['物理'],
      });

      fakeProvider.chatHandler = () =>
        Promise.resolve(
          JSON.stringify({
            title: null,
            readingGrade: ReadingGrade.Middle,
            subjects: ['数学'],
            available: true,
          }),
        );

      const token = await readerToken();
      const res = await request(app.getHttpServer())
        .get('/bibliographic-records/natural')
        .query({ q: '帮我找一本初中能借的数学书' })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as { id: string; reason: string; readingGrade: string }[];
      expect(body.map((r) => r.id)).toEqual([hit.id]);
      expect(body[0].readingGrade).toBe(ReadingGrade.Middle);
      expect(body[0].reason).toContain('初');
      expect(body[0].reason).toContain('数学');
      expect(body[0].reason).toContain('在馆');
    });

    it('查询不含状态时不做在馆过滤（自建记录，不依赖前例数据）', async () => {
      const target = await seedRecord('高中物理进阶', {
        readingGrade: ReadingGrade.Senior,
        subjects: ['物理'],
        withCopy: true,
      });
      fakeProvider.chatHandler = () =>
        Promise.resolve(
          JSON.stringify({ title: null, readingGrade: ReadingGrade.Senior, subjects: [], available: undefined }),
        );
      const token = await readerToken();
      const res = await request(app.getHttpServer())
        .get('/bibliographic-records/natural')
        .query({ q: '高中物理' })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const body = res.body as { id: string }[];
      expect(body.map((r) => r.id)).toContain(target.id);
    });

    it('available=false → 只返回不在馆的书', async () => {
      const inLibrary = await seedRecord('在馆示例书', { withCopy: true });
      const outLibrary = await seedRecord('已借出示例书');
      fakeProvider.chatHandler = () =>
        Promise.resolve(
          JSON.stringify({ title: null, readingGrade: null, subjects: [], available: false }),
        );
      const token = await readerToken();
      const res = await request(app.getHttpServer())
        .get('/bibliographic-records/natural')
        .query({ q: '随便一本不在馆的' })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const body = res.body as { id: string }[];
      expect(body.map((r) => r.id)).toContain(outLibrary.id);
      expect(body.map((r) => r.id)).not.toContain(inLibrary.id);
    });
  });

  describe('AC-3 结构化空结果/空意图时向量语义兜底', () => {
    it('结构化无命中 → 按嵌入向量语义返回并附理由', async () => {
      const target = await seedRecord('用深度学习理解数学');

      fakeProvider.chatHandler = () => Promise.resolve(JSON.stringify({ title: '不存在的书名' }));
      fakeProvider.embedHandler = () => Promise.resolve(FIXED_VECTOR);
      const embeddingService = app.get(EmbeddingService);
      await embeddingService.embedAndStore(target.id, '用深度学习理解数学');

      const token = await readerToken();
      const res = await request(app.getHttpServer())
        .get('/bibliographic-records/natural')
        .query({ q: '机器学习相关的一切' })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as Array<{ id: string; reason: string }>;
      expect(body.length).toBeGreaterThan(0);
      expect(body[0].id).toBe(target.id);
      expect(body[0].reason).toContain('语义相近');
    });

    it('空意图（无任何条件）→ 直接走语义兜底，而非返回全馆藏', async () => {
      const target = await seedRecord('语义目标书');
      fakeProvider.chatHandler = () => Promise.resolve('{}');
      fakeProvider.embedHandler = () => Promise.resolve(FIXED_VECTOR);
      const embeddingService = app.get(EmbeddingService);
      await embeddingService.embedAndStore(target.id, '语义目标书');

      const token = await readerToken();
      const res = await request(app.getHttpServer())
        .get('/bibliographic-records/natural')
        .query({ q: '随便什么' })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as Array<{ id: string; reason: string }>;
      expect(body.map((r) => r.id)).toContain(target.id);
      expect(body.every((r) => r.reason.includes('语义相近'))).toBe(true);
    });

    it('兜底结果遵守硬约束（适读年级）', async () => {
      const seniorTarget = await seedRecord('高中计算思维', { readingGrade: ReadingGrade.Senior });
      const middleDropped = await seedRecord('初中计算入门', { readingGrade: ReadingGrade.Middle });
      fakeProvider.chatHandler = () =>
        Promise.resolve(JSON.stringify({ title: '不存在的书名', readingGrade: ReadingGrade.Senior }));
      fakeProvider.embedHandler = () => Promise.resolve(FIXED_VECTOR);
      const embeddingService = app.get(EmbeddingService);
      await embeddingService.embedAndStore(seniorTarget.id, '计算思维');
      await embeddingService.embedAndStore(middleDropped.id, '计算入门');

      const token = await readerToken();
      const res = await request(app.getHttpServer())
        .get('/bibliographic-records/natural')
        .query({ q: '计算相关的书' })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const body = res.body as Array<{ id: string; reason: string }>;
      expect(body.map((r) => r.id)).toContain(seniorTarget.id);
      expect(body.map((r) => r.id)).not.toContain(middleDropped.id);
    });
  });

  describe('AC-4 确定性命中测试离线可跑 + 校验', () => {
    it('AI 完全不可用（chat 与 embed 均空）→ 返回空数组，不 500、不返回全馆藏', async () => {
      fakeProvider.chatHandler = () => Promise.resolve(null);
      fakeProvider.embedHandler = () => Promise.resolve(null);
      const token = await readerToken();
      const res = await request(app.getHttpServer())
        .get('/bibliographic-records/natural')
        .query({ q: '任意查询' })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toEqual([]);
    });

    it('公共检索 available=真/假 语义正确，非法值不改变语义', async () => {
      const inLibrary = await seedRecord('公共在馆书', { withCopy: true });
      const outLibrary = await seedRecord('公共不在馆书');
      const token = await readerToken();

      const availableOnly = await request(app.getHttpServer())
        .get('/bibliographic-records')
        .query({ available: 'true' })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const availIds = (availableOnly.body as { id: string }[]).map((r) => r.id);
      expect(availIds).toContain(inLibrary.id);
      expect(availIds).not.toContain(outLibrary.id);

      const malformed = await request(app.getHttpServer())
        .get('/bibliographic-records')
        .query({ available: 'not-a-bool' })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const malformedIds = (malformed.body as { id: string }[]).map((r) => r.id);
      expect(malformedIds).toContain(inLibrary.id);
      expect(malformedIds).toContain(outLibrary.id);
    });

    it('缺 token 返回 401', async () => {
      await request(app.getHttpServer()).get('/bibliographic-records/natural').query({ q: '数学' }).expect(401);
    });

    it('缺 q 返回 400（中文校验消息）', async () => {
      const token = await readerToken();
      const res = await request(app.getHttpServer())
        .get('/bibliographic-records/natural')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
      const msg = (res.body as { message: string | string[] }).message;
      expect(Array.isArray(msg) ? msg.join('') : msg).toMatch(/查询词/);
    });
  });
});