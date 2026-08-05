import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { WechatService } from '../src/auth/wechat.service';
import { BibliographicRecord } from '../src/bibliographic-records/bibliographic-record.entity';
import { Copy, CopyStatus } from '../src/copies/copy.entity';
import { LoanRule } from '../src/loans/loan-rule.entity';
import { migrationDataSourceOptions } from '../src/database/database-options';
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

describe('loans (e2e)', () => {
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
      username: `loan-lib-${Date.now()}-${Math.random()}`,
      passwordHash: await bcrypt.hash('librarian-password-1', 10),
      role: StaffRole.Librarian,
      permissions,
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

  async function seedReader(
    cardNumber: string,
    readerType: ReaderType = ReaderType.Student,
  ): Promise<Reader> {
    const repo = dataSource.getRepository(Reader);
    const reader = repo.create({
      cardNumber,
      name: '借阅读者',
      readerType,
      passwordHash: await bcrypt.hash('reader-password-1', 10),
    });
    return repo.save(reader);
  }

  async function readerToken(reader: Reader): Promise<string> {
    const code = `loan-reader-code-${Date.now()}-${Math.random()}`;
    openidByCode.set(code, `loan-reader-openid-${Date.now()}-${Math.random()}`);
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

  async function seedAvailableCopy(barcode: string): Promise<Copy> {
    const record = dataSource
      .getRepository(BibliographicRecord)
      .create({ title: `借阅测试-${barcode}` });
    const saved = await dataSource.getRepository(BibliographicRecord).save(record);
    return dataSource.getRepository(Copy).save(
      dataSource.getRepository(Copy).create({
        barcode,
        status: CopyStatus.Available,
        bibliographicRecordId: saved.id,
      }),
    );
  }

  beforeAll(async () => {
    await ensureTestDatabase();
    dataSource = new DataSource(migrationDataSourceOptions(process.env));
    await dataSource.initialize();
    await dataSource.runMigrations();
    await dataSource.query(
      'TRUNCATE "loan", "loan_rule", "reader", "staff", "bibliographic_record", "copy" RESTART IDENTITY CASCADE',
    );
    await dataSource.query(`
      INSERT INTO "loan_rule" ("reader_type", "max_active_loans", "loan_duration_days") VALUES
        ('student', 5, 30),
        ('teacher', 10, 60),
        ('adult', 5, 30),
        ('child', 3, 21)
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
    await app?.close();
    await dataSource?.destroy();
  });

  describe('AC-1 馆员可办理借出，校验可借额度与馆藏在馆状态', () => {
    it('馆员借出成功，返回借阅记录含到期时间', async () => {
      const reader = await seedReader(`CR-LOAN-${Date.now()}`);
      const copy = await seedAvailableCopy(`BC-LOAN-${Date.now()}`);
      const librarian = await seedLibrarian([Permission.Circulation]);
      const token = await staffToken(librarian);

      const res = await request(app.getHttpServer())
        .post('/loans')
        .set('Authorization', `Bearer ${token}`)
        .send({ readerCardNumber: reader.cardNumber, barcode: copy.barcode })
        .expect(201);
      expect(res.body).toMatchObject({
        copyBarcode: copy.barcode,
        readerId: reader.id,
        returnedAt: null,
      });
      const due = new Date((res.body as { dueAt: string }).dueAt);
      const expected = Date.now() + 30 * 24 * 60 * 60 * 1000;
      expect(Math.abs(due.getTime() - expected)).toBeLessThan(60_000);
    });

    it('副本不在馆（在借）被拒绝（400）', async () => {
      const reader = await seedReader(`CR-LOAN2-${Date.now()}`);
      const copy = await seedAvailableCopy(`BC-LOAN2-${Date.now()}`);
      const librarian = await seedLibrarian([Permission.Circulation]);
      const token = await staffToken(librarian);

      await request(app.getHttpServer())
        .post('/loans')
        .set('Authorization', `Bearer ${token}`)
        .send({ readerCardNumber: reader.cardNumber, barcode: copy.barcode })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/loans')
        .set('Authorization', `Bearer ${token}`)
        .send({ readerCardNumber: reader.cardNumber, barcode: copy.barcode })
        .expect(400);
      expect(res.body.message).toBeTruthy();
    });

    it('副本破损被拒绝（400）', async () => {
      const reader = await seedReader(`CR-LOAN3-${Date.now()}`);
      const record = dataSource
        .getRepository(BibliographicRecord)
        .create({ title: '破损副本' });
      const savedRecord = await dataSource.getRepository(BibliographicRecord).save(record);
      const copy = await dataSource.getRepository(Copy).save(
        dataSource.getRepository(Copy).create({
          barcode: `BC-LOAN3-${Date.now()}`,
          status: CopyStatus.Damaged,
          bibliographicRecordId: savedRecord.id,
        }),
      );
      const librarian = await seedLibrarian([Permission.Circulation]);
      const token = await staffToken(librarian);

      const res = await request(app.getHttpServer())
        .post('/loans')
        .set('Authorization', `Bearer ${token}`)
        .send({ readerCardNumber: reader.cardNumber, barcode: copy.barcode })
        .expect(400);
      expect(res.body.message).toBeTruthy();
    });

    it('读者证号不存在返回 404', async () => {
      const copy = await seedAvailableCopy(`BC-LOAN4-${Date.now()}`);
      const librarian = await seedLibrarian([Permission.Circulation]);
      const token = await staffToken(librarian);
      const res = await request(app.getHttpServer())
        .post('/loans')
        .set('Authorization', `Bearer ${token}`)
        .send({ readerCardNumber: 'CR-NOT-EXIST', barcode: copy.barcode })
        .expect(404);
      expect(res.body.message).toBeTruthy();
    });

    it('条码不存在返回 404', async () => {
      const reader = await seedReader(`CR-LOAN5-${Date.now()}`);
      const librarian = await seedLibrarian([Permission.Circulation]);
      const token = await staffToken(librarian);
      const res = await request(app.getHttpServer())
        .post('/loans')
        .set('Authorization', `Bearer ${token}`)
        .send({ readerCardNumber: reader.cardNumber, barcode: 'BC-NOT-EXIST' })
        .expect(404);
      expect(res.body.message).toBeTruthy();
    });

    it('无流通权限的馆员办理借出被拒绝（403）', async () => {
      const reader = await seedReader(`CR-LOAN6-${Date.now()}`);
      const copy = await seedAvailableCopy(`BC-LOAN6-${Date.now()}`);
      const librarian = await seedLibrarian([Permission.Cataloging]);
      const token = await staffToken(librarian);
      const res = await request(app.getHttpServer())
        .post('/loans')
        .set('Authorization', `Bearer ${token}`)
        .send({ readerCardNumber: reader.cardNumber, barcode: copy.barcode })
        .expect(403);
      expect(res.body.message).toBeTruthy();
    });
  });

  describe('AC-2 借出后副本状态变为在借，读者可借额度扣减', () => {
    it('借出后副本状态落库为在借', async () => {
      const reader = await seedReader(`CR-LOAN7-${Date.now()}`);
      const copy = await seedAvailableCopy(`BC-LOAN7-${Date.now()}`);
      const librarian = await seedLibrarian([Permission.Circulation]);
      const token = await staffToken(librarian);

      await request(app.getHttpServer())
        .post('/loans')
        .set('Authorization', `Bearer ${token}`)
        .send({ readerCardNumber: reader.cardNumber, barcode: copy.barcode })
        .expect(201);

      const persisted = await dataSource
        .getRepository(Copy)
        .findOne({ where: { id: copy.id } });
      expect(persisted?.status).toBe(CopyStatus.Borrowed);
    });

    it('超出可借额度被拒绝（400）', async () => {
      const rule = await dataSource.getRepository(LoanRule).findOne({
        where: { readerType: ReaderType.Student },
      });
      expect(rule).toBeTruthy();
      if (rule) {
        rule.maxActiveLoans = 1;
        await dataSource.getRepository(LoanRule).save(rule);
      }

      const reader = await seedReader(`CR-LOAN8-${Date.now()}`);
      const copy1 = await seedAvailableCopy(`BC-LOAN8A-${Date.now()}`);
      const copy2 = await seedAvailableCopy(`BC-LOAN8B-${Date.now()}`);
      const librarian = await seedLibrarian([Permission.Circulation]);
      const token = await staffToken(librarian);

      await request(app.getHttpServer())
        .post('/loans')
        .set('Authorization', `Bearer ${token}`)
        .send({ readerCardNumber: reader.cardNumber, barcode: copy1.barcode })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/loans')
        .set('Authorization', `Bearer ${token}`)
        .send({ readerCardNumber: reader.cardNumber, barcode: copy2.barcode })
        .expect(400);
      expect(res.body.message).toContain('可借额度');
    });
  });

  describe('AC-3 读者端可查看我的借阅列表与到期时间', () => {
    it('读者可查看自己的借阅列表与到期时间', async () => {
      const reader = await seedReader(`CR-LOAN9-${Date.now()}`);
      const copy = await seedAvailableCopy(`BC-LOAN9-${Date.now()}`);
      const librarian = await seedLibrarian([Permission.Circulation]);
      const librarianToken = await staffToken(librarian);
      await request(app.getHttpServer())
        .post('/loans')
        .set('Authorization', `Bearer ${librarianToken}`)
        .send({ readerCardNumber: reader.cardNumber, barcode: copy.barcode })
        .expect(201);

      const mine = await readerToken(reader);
      const res = await request(app.getHttpServer())
        .get('/loans/me')
        .set('Authorization', `Bearer ${mine}`)
        .expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({ copyBarcode: copy.barcode, returnedAt: null });
      expect((res.body[0] as { dueAt: string }).dueAt).toBeTruthy();
    });

    it('读者看不到其他读者的借阅', async () => {
      const readerA = await seedReader(`CR-LOAN10A-${Date.now()}`);
      const readerB = await seedReader(`CR-LOAN10B-${Date.now()}`);
      const copy = await seedAvailableCopy(`BC-LOAN10-${Date.now()}`);
      const librarian = await seedLibrarian([Permission.Circulation]);
      const librarianToken = await staffToken(librarian);
      await request(app.getHttpServer())
        .post('/loans')
        .set('Authorization', `Bearer ${librarianToken}`)
        .send({ readerCardNumber: readerA.cardNumber, barcode: copy.barcode })
        .expect(201);

      const mineB = await readerToken(readerB);
      const res = await request(app.getHttpServer())
        .get('/loans/me')
        .set('Authorization', `Bearer ${mineB}`)
        .expect(200);
      expect(res.body).toHaveLength(0);
    });

    it('馆员 token 访问我的借阅被拒绝（403）', async () => {
      const librarian = await seedLibrarian([Permission.Circulation]);
      const token = await staffToken(librarian);
      const res = await request(app.getHttpServer())
        .get('/loans/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      expect(res.body.message).toBeTruthy();
    });
  });
});
