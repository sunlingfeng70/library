import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { WechatService } from '../src/auth/wechat.service';
import { Copy, CopyStatus } from '../src/copies/copy.entity';
import { BibliographicRecord } from '../src/bibliographic-records/bibliographic-record.entity';
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

describe('admin config (e2e)', () => {
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

  async function seedStaff(role: StaffRole): Promise<Staff> {
    const repo = dataSource.getRepository(Staff);
    const staff = repo.create({
      username: `adm-${role}-${Date.now()}-${Math.random()}`,
      passwordHash: await bcrypt.hash('librarian-password-1', 10),
      role,
      permissions: [],
    });
    return repo.save(staff);
  }

  async function staffToken(staff: Staff): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/staff/login')
      .send({ username: staff.username, password: 'librarian-password-1' })
      .expect(200);
    return (res.body as { token: string }).token;
  }

  async function seedReader(cardNumber: string, type: string): Promise<Reader> {
    const repo = dataSource.getRepository(Reader);
    const reader = repo.create({
      cardNumber,
      name: '配置读者',
      readerType: type,
      passwordHash: await bcrypt.hash('reader-password-1', 10),
    });
    return repo.save(reader);
  }

  beforeAll(async () => {
    await ensureTestDatabase();
    dataSource = new DataSource(migrationDataSourceOptions(process.env));
    await dataSource.initialize();
    await dataSource.runMigrations();
    await dataSource.query(
      'TRUNCATE "loan", "loan_rule", "reader", "staff", "bibliographic_record", "copy", "reader_type" RESTART IDENTITY CASCADE',
    );
    await dataSource.query(`
      INSERT INTO "reader_type" ("code", "name", "enabled") VALUES
        ('student', '学生', true),
        ('teacher', '教师', true),
        ('adult', '成人', true),
        ('child', '少儿', true)
    `);
    await dataSource.query(`
      INSERT INTO "loan_rule" ("reader_type", "max_active_loans", "loan_duration_days", "fine_daily_fee_cents", "grace_days", "renewal_limit") VALUES
        ('student', 5, 30, 50, 3, 1),
        ('teacher', 10, 60, 50, 3, 2),
        ('adult', 5, 30, 50, 3, 1),
        ('child', 3, 21, 30, 3, 0)
    `);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WechatService)
      .useValue(new FakeWechatService(openidByCode))
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await dataSource.query(`UPDATE "reader_type" SET "enabled" = true`);
    await app?.close();
    await dataSource?.destroy();
  });

  describe('T7 AC-1 管理员可按读者类型配置借阅规则字段', () => {
    it('管理员可查看并更新某一读者类型的规则', async () => {
      const admin = await seedStaff(StaffRole.Administrator);
      const token = await staffToken(admin);

      const listed = await request(app.getHttpServer())
        .get('/admin/loan-rules')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(listed.body).toHaveLength(4);
      const student = listed.body.find(
        (r: { readerType: string }) => r.readerType === 'student',
      );
      expect(student).toMatchObject({ maxActiveLoans: 5, loanDurationDays: 30 });

      const updated = await request(app.getHttpServer())
        .put('/admin/loan-rules/student')
        .set('Authorization', `Bearer ${token}`)
        .send({ maxActiveLoans: 2, loanDurationDays: 14, fineDailyFeeCents: 80, graceDays: 1, renewalLimit: 1 })
        .expect(200);
      expect(updated.body).toMatchObject({
        readerType: 'student',
        maxActiveLoans: 2,
        loanDurationDays: 14,
        fineDailyFeeCents: 80,
        graceDays: 1,
        renewalLimit: 1,
      });
    });

    it('为不存在的读者类型配置规则返回 404', async () => {
      const admin = await seedStaff(StaffRole.Administrator);
      const token = await staffToken(admin);
      const res = await request(app.getHttpServer())
        .put('/admin/loan-rules/nonexistent')
        .set('Authorization', `Bearer ${token}`)
        .send({ maxActiveLoans: 2, loanDurationDays: 14, fineDailyFeeCents: 80, graceDays: 1, renewalLimit: 1 })
        .expect(404);
      expect(res.body.message).toBeTruthy();
    });

    it('非法规则字段被拒绝（400）', async () => {
      const admin = await seedStaff(StaffRole.Administrator);
      const token = await staffToken(admin);
      const res = await request(app.getHttpServer())
        .put('/admin/loan-rules/student')
        .set('Authorization', `Bearer ${token}`)
        .send({ maxActiveLoans: 0, loanDurationDays: -1, fineDailyFeeCents: 80, graceDays: 1, renewalLimit: 1 })
        .expect(400);
      expect(res.body.message).toBeTruthy();
    });
  });

  describe('T7 AC-2 读者类型可在机构配置中定义', () => {
    it('管理员可新增读者类型', async () => {
      const admin = await seedStaff(StaffRole.Administrator);
      const token = await staffToken(admin);

      const created = await request(app.getHttpServer())
        .post('/admin/reader-types')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: 'postgraduate', name: '研究生' })
        .expect(201);
      expect(created.body).toMatchObject({ code: 'postgraduate', name: '研究生', enabled: true });
    });

    it('重复类型 code 被拒绝（400）', async () => {
      const admin = await seedStaff(StaffRole.Administrator);
      const token = await staffToken(admin);
      const res = await request(app.getHttpServer())
        .post('/admin/reader-types')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: 'student', name: '学生' })
        .expect(400);
      expect(res.body.message).toBeTruthy();
    });

    it('空白 code 被拒绝（400）', async () => {
      const admin = await seedStaff(StaffRole.Administrator);
      const token = await staffToken(admin);
      const res = await request(app.getHttpServer())
        .post('/admin/reader-types')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: '   ', name: '空白' })
        .expect(400);
      expect(res.body.message).toBeTruthy();
    });

    it('管理员可停用读者类型', async () => {
      const admin = await seedStaff(StaffRole.Administrator);
      const token = await staffToken(admin);

      const updated = await request(app.getHttpServer())
        .patch('/admin/reader-types/child')
        .set('Authorization', `Bearer ${token}`)
        .send({ enabled: false })
        .expect(200);
      expect(updated.body).toMatchObject({ code: 'child', enabled: false });
    });
  });

  describe('T7 AC-3 借出时按读者类型的规则执行限额', () => {
    it('更新后的规则在借出时生效', async () => {
      const admin = await seedStaff(StaffRole.Administrator);
      const adminToken = await staffToken(admin);
      await request(app.getHttpServer())
        .put('/admin/loan-rules/student')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ maxActiveLoans: 1, loanDurationDays: 30, fineDailyFeeCents: 50, graceDays: 3, renewalLimit: 1 })
        .expect(200);

      const circulation = await seedStaff(StaffRole.Librarian);
      const repo = dataSource.getRepository(Staff);
      const withCirculation = repo.create({
        username: `adm-cir-${Date.now()}-${Math.random()}`,
        passwordHash: await bcrypt.hash('librarian-password-1', 10),
        role: StaffRole.Librarian,
        permissions: [Permission.Circulation],
      });
      await repo.save(withCirculation);
      const circulationToken = await staffToken(withCirculation);

      const reader = await seedReader(`CR-AC3-${Date.now()}`, 'student');

      const record = dataSource.getRepository(BibliographicRecord).create({ title: '规则生效' });
      const savedRecord = await dataSource.getRepository(BibliographicRecord).save(record);
      const copy1 = await dataSource.getRepository(Copy).save(
        dataSource.getRepository(Copy).create({
          barcode: `BC-AC3A-${Date.now()}`,
          status: CopyStatus.Available,
          bibliographicRecordId: savedRecord.id,
        }),
      );
      const copy2 = await dataSource.getRepository(Copy).save(
        dataSource.getRepository(Copy).create({
          barcode: `BC-AC3B-${Date.now()}`,
          status: CopyStatus.Available,
          bibliographicRecordId: savedRecord.id,
        }),
      );

      await request(app.getHttpServer())
        .post('/loans')
        .set('Authorization', `Bearer ${circulationToken}`)
        .send({ readerCardNumber: reader.cardNumber, barcode: copy1.barcode })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/loans')
        .set('Authorization', `Bearer ${circulationToken}`)
        .send({ readerCardNumber: reader.cardNumber, barcode: copy2.barcode })
        .expect(400);
      expect(res.body.message).toContain('可借额度');
    });
  });

  describe('T7 AC-4 权限与差异化配置', () => {
    it('非管理员无法访问配置接口（403）', async () => {
      const librarian = await seedStaff(StaffRole.Librarian);
      const token = await staffToken(librarian);
      const res = await request(app.getHttpServer())
        .get('/admin/loan-rules')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      expect(res.body.message).toBeTruthy();
    });

    it('停用的读者类型不可再创建新读者（400）', async () => {
      const admin = await seedStaff(StaffRole.Administrator);
      const adminToken = await staffToken(admin);
      await request(app.getHttpServer())
        .patch('/admin/reader-types/adult')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ enabled: false })
        .expect(200);

      const circulation = await seedStaff(StaffRole.Librarian);
      const repo = dataSource.getRepository(Staff);
      const withCirculation = repo.create({
        username: `adm-dis-${Date.now()}-${Math.random()}`,
        passwordHash: await bcrypt.hash('librarian-password-1', 10),
        role: StaffRole.Librarian,
        permissions: [Permission.Circulation],
      });
      await repo.save(withCirculation);
      const token = await staffToken(withCirculation);

      const res = await request(app.getHttpServer())
        .post('/readers')
        .set('Authorization', `Bearer ${token}`)
        .send({
          cardNumber: `CR-DIS-${Date.now()}`,
          name: '停用类型读者',
          readerType: 'adult',
          initialPassword: 'reader-password-1',
        })
        .expect(400);
      expect(res.body.message).toContain('未启用');
    });
  });
});
