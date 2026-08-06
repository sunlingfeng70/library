import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { ReadingTagSuggestion, ReadingTagSuggester } from '../src/ai/reading-tag-suggester.service';
import { AppModule } from '../src/app.module';
import { WechatService } from '../src/auth/wechat.service';
import { migrationDataSourceOptions } from '../src/database/database-options';
import { BibliographicRecord, ReadingGrade } from '../src/bibliographic-records/bibliographic-record.entity';
import { IsbnLookupResult, IsbnLookupService } from '../src/bibliographic-records/isbn-lookup.service';
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

class FakeIsbnLookupService implements IsbnLookupService {
  async lookup(isbn: string): Promise<IsbnLookupResult | null> {
    if (isbn === '9787536692930') {
      return {
        title: '时间简史',
        author: '斯蒂芬·霍金',
        publisher: '湖南科学技术出版社',
        category: '科普',
      };
    }
    if (isbn === '9787535732309') {
      return {
        title: '三体',
        author: '刘慈欣',
        publisher: '重庆出版社',
        category: '科幻',
      };
    }
    return null;
  }
}

class FakeReadingTagSuggester implements ReadingTagSuggester {
  async suggest(): Promise<ReadingTagSuggestion | null> {
    return { readingGrade: ReadingGrade.PrimaryHigh, subjects: ['科普', '物理'] };
  }
}

describe('bibliographic enrichment (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
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
      username: `cat-enrich-${Date.now()}-${Math.random()}`,
      passwordHash: await bcrypt.hash('librarian-password-1', 10),
      role: StaffRole.Librarian,
      permissions,
    });
    return repo.save(staff);
  }

  async function seedReader(): Promise<Reader> {
    const repo = dataSource.getRepository(Reader);
    const reader = repo.create({
      cardNumber: `READER-ENRICH-${Date.now()}`,
      name: '检索读者',
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
    const code = `reader-enrich-code-${Date.now()}`;
    openidByCode.set(code, `reader-enrich-openid-${Date.now()}`);
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

  async function seedRecord(title: string, isbn?: string): Promise<BibliographicRecord> {
    const repo = dataSource.getRepository(BibliographicRecord);
    const record = repo.create({ title, isbn: isbn ?? null });
    return repo.save(record);
  }

  beforeAll(async () => {
    await ensureTestDatabase();
    dataSource = new DataSource(migrationDataSourceOptions(process.env));
    await dataSource.initialize();
    await dataSource.runMigrations();
    await dataSource.query(
      'TRUNCATE "reader", "staff", "bibliographic_record" RESTART IDENTITY CASCADE',
    );

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WechatService)
      .useValue(new FakeWechatService(openidByCode))
      .overrideProvider(IsbnLookupService)
      .useClass(FakeIsbnLookupService)
      .overrideProvider(ReadingTagSuggester)
      .useClass(FakeReadingTagSuggester)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await dataSource?.destroy();
  });

  describe('AC-1 输入 ISBN 可从公开书目源补全书目字段', () => {
    it('已知 ISBN 返回补全建议（不落库）', async () => {
      const librarian = await seedLibrarian([Permission.Cataloging]);
      const token = await staffToken(librarian);

      const res = await request(app.getHttpServer())
        .get('/bibliographic-records/isbn-suggestion')
        .query({ isbn: '9787536692930' })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toMatchObject({
        title: '时间简史',
        author: '斯蒂芬·霍金',
        publisher: '湖南科学技术出版社',
        category: '科普',
      });
    });

    it('未知 ISBN 返回空对象', async () => {
      const librarian = await seedLibrarian([Permission.Cataloging]);
      const token = await staffToken(librarian);

      const res = await request(app.getHttpServer())
        .get('/bibliographic-records/isbn-suggestion')
        .query({ isbn: '9787535732316' })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toEqual({});
    });

    it('非法 ISBN 格式被拒绝（400）', async () => {
      const librarian = await seedLibrarian([Permission.Cataloging]);
      const token = await staffToken(librarian);

      const res = await request(app.getHttpServer())
        .get('/bibliographic-records/isbn-suggestion')
        .query({ isbn: 'not-an-isbn' })
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
      expect(res.body.message).toBeTruthy();
    });

    it('以补全字段确认保存到书目记录', async () => {
      const librarian = await seedLibrarian([Permission.Cataloging]);
      const token = await staffToken(librarian);
      const record = await seedRecord('待补全书目', '9787536692930');

      const res = await request(app.getHttpServer())
        .patch(`/bibliographic-records/${record.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: '时间简史', author: '斯蒂芬·霍金', publisher: '湖南科学技术出版社' })
        .expect(200);
      expect(res.body).toMatchObject({
        title: '时间简史',
        author: '斯蒂芬·霍金',
        publisher: '湖南科学技术出版社',
      });
    });

    it('输入 ISBN 可直接创建并自动补全书目字段', async () => {
      const librarian = await seedLibrarian([Permission.Cataloging]);
      const token = await staffToken(librarian);

      const res = await request(app.getHttpServer())
        .post('/bibliographic-records/by-isbn')
        .set('Authorization', `Bearer ${token}`)
        .send({ isbn: '9787535732309' })
        .expect(201);
      expect(res.body).toMatchObject({
        title: '三体',
        author: '刘慈欣',
        publisher: '重庆出版社',
        isbn: '9787535732309',
        category: '科幻',
      });

      const persisted = await dataSource
        .getRepository(BibliographicRecord)
        .findOne({ where: { id: res.body.id } });
      expect(persisted?.isbn).toBe('9787535732309');
    });

    it('未知 ISBN 无法创建（400）', async () => {
      const librarian = await seedLibrarian([Permission.Cataloging]);
      const token = await staffToken(librarian);

      const res = await request(app.getHttpServer())
        .post('/bibliographic-records/by-isbn')
        .set('Authorization', `Bearer ${token}`)
        .send({ isbn: '9787535732316' })
        .expect(400);
      expect(res.body.message).toBeTruthy();
    });
  });

  describe('AC-2 LLM 建议阅读标签（适读年级/学科），馆员确认保存', () => {
    it('馆员为书目请求阅读标签建议', async () => {
      const librarian = await seedLibrarian([Permission.Cataloging]);
      const token = await staffToken(librarian);
      const record = await seedRecord('时间简史');

      const res = await request(app.getHttpServer())
        .post(`/bibliographic-records/${record.id}/reading-tags/suggest`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toMatchObject({
        readingGrade: ReadingGrade.PrimaryHigh,
        subjects: ['科普', '物理'],
      });
    });

    it('馆员确认后保存结构化阅读标签', async () => {
      const librarian = await seedLibrarian([Permission.Cataloging]);
      const token = await staffToken(librarian);
      const record = await seedRecord('数学之美');

      const res = await request(app.getHttpServer())
        .patch(`/bibliographic-records/${record.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ readingGrade: ReadingGrade.PrimaryLow, subjects: ['数学', '科普'] })
        .expect(200);
      expect(res.body).toMatchObject({
        readingGrade: ReadingGrade.PrimaryLow,
        subjects: ['数学', '科普'],
      });

      const persisted = await dataSource
        .getRepository(BibliographicRecord)
        .findOne({ where: { id: record.id } });
      expect(persisted?.readingGrade).toBe(ReadingGrade.PrimaryLow);
      expect(persisted?.subjects).toEqual(['数学', '科普']);
    });
  });

  describe('AC-3 无 ISBN 旧书仍可手工录入', () => {
    it('无 ISBN 图书创建成功（readingGrade/subjects 为 null）', async () => {
      const librarian = await seedLibrarian([Permission.Cataloging]);
      const token = await staffToken(librarian);

      const res = await request(app.getHttpServer())
        .post('/bibliographic-records')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: '手工录入旧书' })
        .expect(201);
      expect(res.body.isbn).toBeNull();
      expect(res.body.readingGrade).toBeNull();
      expect(res.body.subjects).toBeNull();
    });
  });

  describe('AC-4 阅读标签成为检索可直接消费的结构化字段', () => {
    it('读者可按适读年级过滤书目', async () => {
      const token = await readerToken();
      const res = await request(app.getHttpServer())
        .get('/bibliographic-records')
        .query({ readingGrade: ReadingGrade.PrimaryLow })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body.every((r: { readingGrade: string }) => r.readingGrade === ReadingGrade.PrimaryLow)).toBe(true);
    });

    it('读者可按学科标签过滤书目', async () => {
      const token = await readerToken();
      const res = await request(app.getHttpServer())
        .get('/bibliographic-records')
        .query({ subject: '数学' })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('书目视图包含结构化标签字段', async () => {
      const token = await readerToken();
      const res = await request(app.getHttpServer())
        .get('/bibliographic-records')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.length).toBeGreaterThan(0);
      const record: { readingGrade: unknown; subjects: unknown } = res.body[0];
      expect('readingGrade' in record).toBe(true);
      expect('subjects' in record).toBe(true);
    });
  });

  describe('权限保护', () => {
    it('无 cataloging 权限的馆员访问补全/建议/更新端点被拒绝（403）', async () => {
      const noAccess = await seedLibrarian([Permission.Circulation]);
      const token = await staffToken(noAccess);
      const record = await seedRecord('权限测试');

      await request(app.getHttpServer())
        .get('/bibliographic-records/isbn-suggestion')
        .query({ isbn: '9787536692930' })
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      await request(app.getHttpServer())
        .post(`/bibliographic-records/${record.id}/reading-tags/suggest`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      await request(app.getHttpServer())
        .patch(`/bibliographic-records/${record.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'x' })
        .expect(403);
    });

    it('读者访问馆员端点被拒绝（403）', async () => {
      const token = await readerToken();
      await request(app.getHttpServer())
        .get('/bibliographic-records/isbn-suggestion')
        .query({ isbn: '9787536692930' })
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });
  });
});