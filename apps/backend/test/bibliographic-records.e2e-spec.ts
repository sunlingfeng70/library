import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { WechatService } from '../src/auth/wechat.service';
import { migrationDataSourceOptions } from '../src/database/database-options';
import { BibliographicRecord } from '../src/bibliographic-records/bibliographic-record.entity';
import { Reader, ReaderType } from '../src/readers/reader.entity';
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

describe('bibliographic records (e2e)', () => {
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

  async function seedAdministrator(): Promise<Staff> {
    const repo = dataSource.getRepository(Staff);
    const existing = await repo.findOne({ where: { username: 'bib-admin' } });
    if (existing) {
      return existing;
    }
    const staff = repo.create({
      username: 'bib-admin',
      passwordHash: await bcrypt.hash('librarian-password-1', 10),
      role: StaffRole.Administrator,
    });
    return repo.save(staff);
  }

  async function seedLibrarian(permissions: Permission[]): Promise<Staff> {
    const repo = dataSource.getRepository(Staff);
    const staff = repo.create({
      username: `bib-lib-${Date.now()}-${Math.random()}`,
      passwordHash: await bcrypt.hash('librarian-password-1', 10),
      role: StaffRole.Librarian,
      permissions,
    });
    return repo.save(staff);
  }

  async function seedReader(): Promise<Reader> {
    const repo = dataSource.getRepository(Reader);
    const reader = repo.create({
      cardNumber: `BR-${Date.now()}`,
      name: '检索读者',
      readerType: ReaderType.Student,
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
    const code = `reader-code-${Date.now()}`;
    openidByCode.set(code, `reader-openid-${Date.now()}`);
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
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await dataSource?.destroy();
  });

  describe('AC-1 馆员可通过 API 创建一条书目', () => {
    it('具有 cataloging 权限的馆员创建书目成功', async () => {
      const librarian = await seedLibrarian([Permission.Cataloging]);
      const token = await staffToken(librarian);

      const res = await request(app.getHttpServer())
        .post('/bibliographic-records')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: '时间简史',
          author: '斯蒂芬·霍金',
          publisher: '湖南科学技术出版社',
          isbn: '9787535732309',
          category: '科普',
        })
        .expect(201);
      expect(res.body).toMatchObject({
        title: '时间简史',
        author: '斯蒂芬·霍金',
        publisher: '湖南科学技术出版社',
        isbn: '9787535732309',
        category: '科普',
      });
      expect(res.body.id).toBeDefined();
    });

    it('无 cataloging 权限的馆员创建被拒绝（403）', async () => {
      const noAccess = await seedLibrarian([Permission.Circulation]);
      const token = await staffToken(noAccess);

      const res = await request(app.getHttpServer())
        .post('/bibliographic-records')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: '未授权书目' })
        .expect(403);
      expect(res.body.message).toBeTruthy();
    });

    it('未登录访问创建接口被拒绝（401）', async () => {
      const res = await request(app.getHttpServer())
        .post('/bibliographic-records')
        .send({ title: '未登录书目' })
        .expect(401);
      expect(res.body.message).toBeTruthy();
    });

    it('空白标题创建被拒绝（400）', async () => {
      const librarian = await seedLibrarian([Permission.Cataloging]);
      const token = await staffToken(librarian);
      const res = await request(app.getHttpServer())
        .post('/bibliographic-records')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: '   ' })
        .expect(400);
      expect(res.body.message).toBeTruthy();
    });
  });

  describe('AC-2 书目持久化，ISBN 唯一约束生效', () => {
    it('重复 ISBN 创建被拒绝（400）', async () => {
      const librarian = await seedLibrarian([Permission.Cataloging]);
      const token = await staffToken(librarian);

      await request(app.getHttpServer())
        .post('/bibliographic-records')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: '第一次', isbn: '9787111000001' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/bibliographic-records')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: '第二次', isbn: '9787111000001' })
        .expect(400);
      expect(res.body.message).toBeTruthy();
    });

    it('无 ISBN 的旧书可创建（isbn 为空）', async () => {
      const librarian = await seedLibrarian([Permission.Cataloging]);
      const token = await staffToken(librarian);

      const res = await request(app.getHttpServer())
        .post('/bibliographic-records')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: '无 ISBN 旧书' })
        .expect(201);
      expect(res.body.isbn).toBeNull();

      const persisted = await dataSource
        .getRepository(BibliographicRecord)
        .findOne({ where: { id: res.body.id } });
      expect(persisted?.title).toBe('无 ISBN 旧书');
    });
  });

  describe('AC-3 读者端可列出书目并按题名/ISBN 检索', () => {
    it('读者可列出全部书目', async () => {
      const token = await readerToken();
      const res = await request(app.getHttpServer())
        .get('/bibliographic-records')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('读者可按题名检索（LIKE 匹配）', async () => {
      const librarian = await seedLibrarian([Permission.Cataloging]);
      const createToken = await staffToken(librarian);
      await request(app.getHttpServer())
        .post('/bibliographic-records')
        .set('Authorization', `Bearer ${createToken}`)
        .send({ title: '三体', author: '刘慈欣', isbn: '9787536692930' })
        .expect(201);

      const token = await readerToken();
      const res = await request(app.getHttpServer())
        .get('/bibliographic-records')
        .query({ title: '三体' })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].title).toBe('三体');
    });

    it('读者可按 ISBN 检索', async () => {
      const token = await readerToken();
      const res = await request(app.getHttpServer())
        .get('/bibliographic-records')
        .query({ isbn: '9787535732309' })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body.every((r: { isbn: string }) => r.isbn === '9787535732309')).toBe(true);
    });

    it('读者未登录访问列表被拒绝（401）', async () => {
      const res = await request(app.getHttpServer()).get('/bibliographic-records').expect(401);
      expect(res.body.message).toBeTruthy();
    });
  });
});