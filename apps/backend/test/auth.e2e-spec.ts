import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { WechatService } from '../src/auth/wechat.service';
import { migrationDataSourceOptions } from '../src/database/database-options';
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

describe('auth + readers (e2e)', () => {
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
    const existing = await repo.findOne({ where: { username: 'admin' } });
    if (existing) {
      return existing;
    }
    const staff = repo.create({
      username: 'admin',
      passwordHash: await bcrypt.hash('librarian-password-1', 10),
      role: StaffRole.Administrator,
    });
    return repo.save(staff);
  }

  async function seedLibrarian(permissions: Permission[]): Promise<Staff> {
    const repo = dataSource.getRepository(Staff);
    const staff = repo.create({
      username: `lib-${permissions.length}-${Date.now()}`,
      passwordHash: await bcrypt.hash('librarian-password-1', 10),
      role: StaffRole.Librarian,
      permissions,
    });
    return repo.save(staff);
  }

  async function seedReader(cardNumber: string, name: string, type: string): Promise<Reader> {
    const repo = dataSource.getRepository(Reader);
    const reader = repo.create({
      cardNumber,
      name,
      readerType: type,
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

  beforeAll(async () => {
    await ensureTestDatabase();
    dataSource = new DataSource(migrationDataSourceOptions(process.env));
    await dataSource.initialize();
    await dataSource.runMigrations();
    await dataSource.query('TRUNCATE "reader", "staff" RESTART IDENTITY CASCADE');

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

  describe('AC-1 读者微信授权登录（openid 绑定）与证号密码首绑', () => {
    it('未绑定 openid 的读者登录返回 bound:false', async () => {
      openidByCode.set('code-unbound', 'openid-unbound');
      const res = await request(app.getHttpServer())
        .post('/auth/wechat/login')
        .send({ code: 'code-unbound' })
        .expect(200);
      expect(res.body).toEqual({ bound: false });
    });

    it('证号 + 初始密码首绑成功，之后可扫码直接登录', async () => {
      const reader = await seedReader('R001', '张三', 'student');
      openidByCode.set('code-bind', 'openid-zhangsan');

      const bind = await request(app.getHttpServer())
        .post('/auth/bind')
        .send({ code: 'code-bind', cardNumber: 'R001', password: 'reader-password-1' })
        .expect(200);
      expect(bind.body.token).toBeDefined();

      const login = await request(app.getHttpServer())
        .post('/auth/wechat/login')
        .send({ code: 'code-bind' })
        .expect(200);
      expect(login.body).toMatchObject({ bound: true });
      expect(login.body.token).toBeDefined();

      const persisted = await dataSource
        .getRepository(Reader)
        .findOne({ where: { id: reader.id } });
      expect(persisted?.openid).toBe('openid-zhangsan');
    });

    it('证号或初始密码错误时首绑失败', async () => {
      await seedReader('R002', '李四', 'teacher');
      openidByCode.set('code-bad', 'openid-lisi');
      const res = await request(app.getHttpServer())
        .post('/auth/bind')
        .send({ code: 'code-bad', cardNumber: 'R002', password: 'wrong-password' })
        .expect(401);
      expect(res.body.message).toBeTruthy();
    });

    it('已绑定读者用另一个 openid 二次绑定被拒绝', async () => {
      const reader = await seedReader('R003', '赵六', 'child');
      openidByCode.set('code-first', 'openid-zhaoliu');
      await request(app.getHttpServer())
        .post('/auth/bind')
        .send({ code: 'code-first', cardNumber: 'R003', password: 'reader-password-1' })
        .expect(200);

      openidByCode.set('code-second', 'openid-other');
      const res = await request(app.getHttpServer())
        .post('/auth/bind')
        .send({ code: 'code-second', cardNumber: 'R003', password: 'reader-password-1' })
        .expect(401);
      expect(res.body.message).toBeTruthy();

      const persisted = await dataSource
        .getRepository(Reader)
        .findOne({ where: { id: reader.id } });
      expect(persisted?.openid).toBe('openid-zhaoliu');
    });
  });

  describe('AC-3 管理员创建馆员账号并赋细粒度权限', () => {
    it('管理员可创建馆员并赋予权限', async () => {
      const admin = await seedAdministrator();
      const token = await staffToken(admin);

      const created = await request(app.getHttpServer())
        .post('/staff')
        .set('Authorization', `Bearer ${token}`)
        .send({
          username: 'cataloguer',
          password: 'cataloguer-pass-8',
          role: 'librarian',
          permissions: ['cataloging'],
        })
        .expect(201);
      expect(created.body).toMatchObject({
        username: 'cataloguer',
        role: 'librarian',
        permissions: ['cataloging'],
      });

      const staff = await dataSource
        .getRepository(Staff)
        .findOne({ where: { username: 'cataloguer' } });
      expect(staff).not.toBeNull();
    });

    it('非管理员（普通馆员）不能创建馆员', async () => {
      const plain = await seedLibrarian([Permission.Cataloging]);
      const token = await staffToken(plain);
      openidByCode.set('code-lib', 'openid-lib');
      const res = await request(app.getHttpServer())
        .post('/staff')
        .set('Authorization', `Bearer ${token}`)
        .send({
          username: 'should-not-exist',
          password: 'whatever-pass-9',
          role: 'librarian',
          permissions: [],
        })
        .expect(403);
      expect(res.body.message).toBeTruthy();
    });

    it('管理员不能通过 API 创建额外管理员', async () => {
      const admin = await seedAdministrator();
      const token = await staffToken(admin);
      const res = await request(app.getHttpServer())
        .post('/staff')
        .set('Authorization', `Bearer ${token}`)
        .send({
          username: 'rogue-admin',
          password: 'whatever-pass-9',
          role: 'administrator',
          permissions: [],
        })
        .expect(400);
      expect(res.body.message).toBeTruthy();
    });

    it('管理员更新馆员权限', async () => {
      const admin = await seedAdministrator();
      const token = await staffToken(admin);
      const librarian = await seedLibrarian([]);

      const res = await request(app.getHttpServer())
        .patch(`/staff/${librarian.id}/permissions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ permissions: ['fine', 'reporting'] })
        .expect(200);
      expect(res.body.permissions).toEqual(['fine', 'reporting']);
    });
  });

  describe('AC-2 三层角色区分，权限校验作用于 API', () => {
    it('无 circulation 权限的馆员无法创建读者档案（403）', async () => {
      const catalogOnly = await seedLibrarian([Permission.Cataloging]);
      const token = await staffToken(catalogOnly);
      openidByCode.set('code-noperm', 'openid-noperm');
      const res = await request(app.getHttpServer())
        .post('/readers')
        .set('Authorization', `Bearer ${token}`)
        .send({
          cardNumber: 'R100',
          name: '王五',
          readerType: 'adult',
          initialPassword: 'reader-password-1',
        })
        .expect(403);
      expect(res.body.message).toBeTruthy();
    });

    it('有 circulation 权限的馆员可创建读者档案', async () => {
      const circulating = await seedLibrarian([Permission.Circulation]);
      const token = await staffToken(circulating);
      openidByCode.set('code-ok', 'openid-ok');
      const res = await request(app.getHttpServer())
        .post('/readers')
        .set('Authorization', `Bearer ${token}`)
        .send({
          cardNumber: 'R101',
          name: '王五',
          readerType: 'adult',
          initialPassword: 'reader-password-1',
        })
        .expect(201);
      expect(res.body).toMatchObject({
        cardNumber: 'R101',
        name: '王五',
        readerType: 'adult',
        openidBound: false,
      });
    });

    it('未提供 token 访问受保护接口返回 401', async () => {
      const res = await request(app.getHttpServer()).get('/readers').expect(401);
      expect(res.body.message).toBeTruthy();
    });
  });

  describe('AC-4 读者档案建立，含读者类型属性', () => {
    it('读者类型四种取值均可建立', async () => {
      const circulating = await seedLibrarian([Permission.Circulation]);
      const token = await staffToken(circulating);
      openidByCode.set('code-type', 'openid-type');

      const types: string[] = [
        'student',
        'teacher',
        'adult',
        'child',
      ];
      for (let i = 0; i < types.length; i++) {
        const cardNumber = `RT00${i}`;
        const res = await request(app.getHttpServer())
          .post('/readers')
          .set('Authorization', `Bearer ${token}`)
          .send({
            cardNumber,
            name: `类型${i}`,
            readerType: types[i],
            initialPassword: 'reader-password-1',
          })
          .expect(201);
        expect(res.body.readerType).toBe(types[i]);
      }
    });
  });
});