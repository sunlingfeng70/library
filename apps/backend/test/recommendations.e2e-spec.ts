import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { AiChatRequest, AiProvider } from '../src/ai/ai-provider.service';
import { AppModule } from '../src/app.module';
import { WechatService } from '../src/auth/wechat.service';
import { migrationDataSourceOptions } from '../src/database/database-options';
import { BibliographicRecord, ReadingGrade } from '../src/bibliographic-records/bibliographic-record.entity';
import { Copy, CopyStatus } from '../src/copies/copy.entity';
import { Loan } from '../src/loans/loan.entity';
import { Reader } from '../src/readers/reader.entity';
import { Permission, Staff, StaffRole } from '../src/staff/staff.entity';

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';

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

class FakeAiProvider implements AiProvider {
  chatHandler: (request: AiChatRequest) => Promise<string | null> = () => Promise.resolve(null);
  embedHandler: () => Promise<number[] | null> = () => Promise.resolve(null);

  chat(request: AiChatRequest): Promise<string | null> {
    return this.chatHandler(request);
  }

  embed(_text: string): Promise<number[] | null> {
    return this.embedHandler();
  }
}

describe('recommendations (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let fakeProvider: FakeAiProvider;
  const openidByCode = new Map<string, string>();
  const host = process.env.DB_HOST ?? 'localhost';
  const port = parseInt(process.env.DB_PORT ?? '5433', 10);
  const username = process.env.DB_USER ?? 'library';
  const password = process.env.DB_PASSWORD ?? 'library';

  async function ensureTestDatabase(): Promise<void> {
    const bootstrap = new DataSource({ type: 'postgres', host, port, username, password, database: 'postgres', synchronize: false });
    await bootstrap.initialize();
    try {
      await bootstrap.query('CREATE DATABASE library_test');
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (!/already exists/.test(err.message)) {
        throw error;
      }
    } finally {
      await bootstrap.destroy();
    }
  }

  async function seedReader(name: string): Promise<Reader> {
    return dataSource.getRepository(Reader).save(
      dataSource.getRepository(Reader).create({
        cardNumber: `RECOMMENDATION-${Date.now()}-${Math.random()}`,
        name,
        readerType: 'student',
        passwordHash: await bcrypt.hash('reader-password-1', 10),
      }),
    );
  }

  async function readerToken(reader: Reader): Promise<string> {
    const code = `recommendation-code-${Date.now()}-${Math.random()}`;
    openidByCode.set(code, `recommendation-openid-${Date.now()}-${Math.random()}`);
    await request(app.getHttpServer()).post('/auth/bind').send({ code, cardNumber: reader.cardNumber, password: 'reader-password-1' }).expect(200);
    const login = await request(app.getHttpServer()).post('/auth/wechat/login').send({ code }).expect(200);
    const body: { token: string } = login.body;
    return body.token;
  }

  async function staffToken(): Promise<string> {
    const staff = await dataSource.getRepository(Staff).save(
      dataSource.getRepository(Staff).create({
        username: `recommendation-staff-${Date.now()}-${Math.random()}`,
        passwordHash: await bcrypt.hash('staff-password-1', 10),
        role: StaffRole.Librarian,
        permissions: [Permission.Circulation],
      }),
    );
    const login = await request(app.getHttpServer())
      .post('/auth/staff/login')
      .send({ username: staff.username, password: 'staff-password-1' })
      .expect(200);
    const body: { token: string } = login.body;
    return body.token;
  }

  async function seedRecord(title: string, values: Partial<BibliographicRecord> = {}, status?: CopyStatus): Promise<BibliographicRecord> {
    const record = await dataSource.getRepository(BibliographicRecord).save(
      dataSource.getRepository(BibliographicRecord).create({
        title,
        author: '测试作者',
        category: '科普',
        readingGrade: ReadingGrade.Middle,
        subjects: ['数学'],
        ...values,
      }),
    );
    if (status) {
      await dataSource.getRepository(Copy).save(
        dataSource.getRepository(Copy).create({
          barcode: `RECOMMENDATION-COPY-${Date.now()}-${Math.random()}`,
          status,
          bibliographicRecordId: record.id,
        }),
      );
    }
    return record;
  }

  async function seedLoan(readerId: string, recordId: string): Promise<void> {
    const copy = await dataSource.getRepository(Copy).findOneOrFail({ where: { bibliographicRecordId: recordId } });
    await dataSource.getRepository(Loan).save(
      dataSource.getRepository(Loan).create({
        copyId: copy.id,
        readerId,
        borrowedAt: new Date(0),
        dueAt: new Date(Date.now() + 86400000),
        returnedAt: null,
      }),
    );
  }

  beforeAll(async () => {
    await ensureTestDatabase();
    dataSource = new DataSource(migrationDataSourceOptions(process.env));
    await dataSource.initialize();
    await dataSource.runMigrations();
    await dataSource.query('TRUNCATE "loan", "reader", "staff", "bibliographic_record", "copy" RESTART IDENTITY CASCADE');
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

  beforeEach(async () => {
    await dataSource.query('TRUNCATE "loan", "reader", "staff", "bibliographic_record", "copy" RESTART IDENTITY CASCADE');
    openidByCode.clear();
  });

  afterEach(async () => {
    fakeProvider.chatHandler = () => Promise.resolve(null);
  });

  afterAll(async () => {
    await app?.close();
    await dataSource?.destroy();
  });

  it('uses borrow history and AI reasons while excluding already borrowed records', async () => {
    const reader = await seedReader('有借阅历史的读者');
    const borrowed = await seedRecord('已借阅数学书', {}, CopyStatus.Borrowed);
    const candidate = await seedRecord('推荐数学书', { title: '推荐数学书' }, CopyStatus.Available);
    await seedLoan(reader.id, borrowed.id);
    fakeProvider.chatHandler = () => Promise.resolve(JSON.stringify({ items: [{ recordId: candidate.id, reason: 'AI 推荐理由' }] }));

    const res = await request(app.getHttpServer()).get('/recommendations').set('Authorization', `Bearer ${await readerToken(reader)}`).expect(200);
    const body: Array<{ recordId: string; reason: string }> = res.body;
    expect(body.map((item) => item.recordId)).toContain(candidate.id);
    expect(body.map((item) => item.recordId)).not.toContain(borrowed.id);
    expect(body.find((item) => item.recordId === candidate.id)?.reason).toBe('AI 推荐理由');
  });

  it('cold start returns an available rule-based recommendation and noop collaborative source contributes nothing', async () => {
    const reader = await seedReader('冷启动读者');
    const candidate = await seedRecord('冷启动推荐书', {}, CopyStatus.Available);
    const res = await request(app.getHttpServer()).get('/recommendations').set('Authorization', `Bearer ${await readerToken(reader)}`).expect(200);
    const body: Array<{ recordId: string; reason: string; source: string }> = res.body;
    expect(body.map((item) => item.recordId)).toContain(candidate.id);
    expect(body[0].reason).toBe('为「学生」读者精选在馆图书');
    expect(body.some((item) => item.source === 'collaborative')).toBe(false);
  });

it('falls back to the deterministic rule reason when AI returns null', async () => {
    const reader = await seedReader('AI 不可用读者');
    const candidate = await seedRecord('规则推荐书', {}, CopyStatus.Available);
    const res = await request(app.getHttpServer()).get('/recommendations').set('Authorization', `Bearer ${await readerToken(reader)}`).expect(200);
    const body: Array<{ recordId: string; reason: string }> = res.body;
    expect(body.find((item) => item.recordId === candidate.id)?.reason).toBe('为「学生」读者精选在馆图书');
  });

  it('requires a reader JWT and rejects staff principals', async () => {
    await request(app.getHttpServer()).get('/recommendations').expect(401);
    await request(app.getHttpServer()).get('/recommendations').set('Authorization', `Bearer ${await staffToken()}`).expect(403);
  });
});
