import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { WechatService } from '../src/auth/wechat.service';
import { BibliographicRecord } from '../src/bibliographic-records/bibliographic-record.entity';
import { Copy, CopyStatus } from '../src/copies/copy.entity';
import { Fine } from '../src/loans/fine.entity';
import { Loan } from '../src/loans/loan.entity';
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
      INSERT INTO "loan_rule" ("reader_type", "max_active_loans", "loan_duration_days", "fine_daily_fee_cents", "grace_days") VALUES
        ('student', 5, 30, 50, 3),
        ('teacher', 10, 60, 50, 3),
        ('adult', 5, 30, 50, 3),
        ('child', 3, 21, 30, 3)
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

  describe('T6 AC-1 馆员可办理归还，副本状态回到在馆', () => {
    it('归还成功：副本状态回到在馆，借阅记录 closed', async () => {
      const reader = await seedReader(`CR-RET1-${Date.now()}`);
      const copy = await seedAvailableCopy(`BC-RET1-${Date.now()}`);
      const circulation = await seedLibrarian([Permission.Circulation]);
      const token = await staffToken(circulation);
      await request(app.getHttpServer())
        .post('/loans')
        .set('Authorization', `Bearer ${token}`)
        .send({ readerCardNumber: reader.cardNumber, barcode: copy.barcode })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/loans/return')
        .set('Authorization', `Bearer ${token}`)
        .send({ barcode: copy.barcode })
        .expect(201);
      expect(res.body).toMatchObject({ copyBarcode: copy.barcode, fine: null });
      expect((res.body as { returnedAt: string }).returnedAt).toBeTruthy();

      const persisted = await dataSource.getRepository(Copy).findOne({
        where: { id: copy.id },
      });
      expect(persisted?.status).toBe(CopyStatus.Available);
    });

    it('归还未在借的副本被拒绝（400）', async () => {
      const copy = await seedAvailableCopy(`BC-RET2-${Date.now()}`);
      const circulation = await seedLibrarian([Permission.Circulation]);
      const token = await staffToken(circulation);
      const res = await request(app.getHttpServer())
        .post('/loans/return')
        .set('Authorization', `Bearer ${token}`)
        .send({ barcode: copy.barcode })
        .expect(400);
      expect(res.body.message).toBeTruthy();
    });

    it('归还不存在的条码返回 404', async () => {
      const circulation = await seedLibrarian([Permission.Circulation]);
      const token = await staffToken(circulation);
      const res = await request(app.getHttpServer())
        .post('/loans/return')
        .set('Authorization', `Bearer ${token}`)
        .send({ barcode: 'BC-RET-NONE' })
        .expect(404);
      expect(res.body.message).toBeTruthy();
    });
  });

  describe('T6 AC-2 逾期天数与罚款金额正确计算，宽限期生效', () => {
    it('宽限期内归还不产生罚款', async () => {
      const rule = await dataSource.getRepository(LoanRule).findOne({
        where: { readerType: ReaderType.Student },
      });
      if (rule) {
        rule.graceDays = 3;
        rule.fineDailyFeeCents = 50;
        await dataSource.getRepository(LoanRule).save(rule);
      }

      const reader = await seedReader(`CR-RET3-${Date.now()}`);
      const copy = await seedAvailableCopy(`BC-RET3-${Date.now()}`);
      const circulation = await seedLibrarian([Permission.Circulation]);
      const token = await staffToken(circulation);
      const checkout = await request(app.getHttpServer())
        .post('/loans')
        .set('Authorization', `Bearer ${token}`)
        .send({ readerCardNumber: reader.cardNumber, barcode: copy.barcode })
        .expect(201);
      const loanId = checkout.body.id as string;

      const loan = await dataSource.getRepository(Loan).findOne({ where: { id: loanId } });
      if (!loan) {
        throw new Error('loan missing');
      }
      loan.borrowedAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
      loan.dueAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      await dataSource.getRepository(Loan).save(loan);

      const res = await request(app.getHttpServer())
        .post('/loans/return')
        .set('Authorization', `Bearer ${token}`)
        .send({ barcode: copy.barcode })
        .expect(201);
      expect(res.body.fine).toBeNull();
    });

    it('超过宽限期归还按每日单价计算罚款', async () => {
      const rule = await dataSource.getRepository(LoanRule).findOne({
        where: { readerType: ReaderType.Student },
      });
      if (rule) {
        rule.graceDays = 3;
        rule.fineDailyFeeCents = 50;
        await dataSource.getRepository(LoanRule).save(rule);
      }

      const reader = await seedReader(`CR-RET4-${Date.now()}`);
      const copy = await seedAvailableCopy(`BC-RET4-${Date.now()}`);
      const circulation = await seedLibrarian([Permission.Circulation]);
      const token = await staffToken(circulation);
      const checkout = await request(app.getHttpServer())
        .post('/loans')
        .set('Authorization', `Bearer ${token}`)
        .send({ readerCardNumber: reader.cardNumber, barcode: copy.barcode })
        .expect(201);
      const loanId = checkout.body.id as string;

      const loan = await dataSource.getRepository(Loan).findOne({ where: { id: loanId } });
      if (!loan) {
        throw new Error('loan missing');
      }
      loan.borrowedAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
      loan.dueAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      await dataSource.getRepository(Loan).save(loan);

      const res = await request(app.getHttpServer())
        .post('/loans/return')
        .set('Authorization', `Bearer ${token}`)
        .send({ barcode: copy.barcode })
        .expect(201);
      expect(res.body.fine).toMatchObject({ amountCents: 350, reason: '逾期 7 天' });
    });
  });

  describe('T6 AC-3 产生罚款欠款记录；馆员可标记收款结清', () => {
    it('逾期归还产生欠款记录，馆员可结清', async () => {
      const rule = await dataSource.getRepository(LoanRule).findOne({
        where: { readerType: ReaderType.Student },
      });
      if (rule) {
        rule.graceDays = 0;
        rule.fineDailyFeeCents = 100;
        await dataSource.getRepository(LoanRule).save(rule);
      }

      const reader = await seedReader(`CR-RET5-${Date.now()}`);
      const copy = await seedAvailableCopy(`BC-RET5-${Date.now()}`);
      const circulation = await seedLibrarian([Permission.Circulation]);
      const fineManager = await seedLibrarian([Permission.Circulation, Permission.Fine]);
      const circulationToken = await staffToken(circulation);
      const fineToken = await staffToken(fineManager);

      const checkout = await request(app.getHttpServer())
        .post('/loans')
        .set('Authorization', `Bearer ${circulationToken}`)
        .send({ readerCardNumber: reader.cardNumber, barcode: copy.barcode })
        .expect(201);
      const loanId = checkout.body.id as string;

      const loan = await dataSource.getRepository(Loan).findOne({ where: { id: loanId } });
      if (!loan) {
        throw new Error('loan missing');
      }
      loan.borrowedAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
      loan.dueAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      await dataSource.getRepository(Loan).save(loan);

      const returned = await request(app.getHttpServer())
        .post('/loans/return')
        .set('Authorization', `Bearer ${circulationToken}`)
        .send({ barcode: copy.barcode })
        .expect(201);
      const fineId = returned.body.fine.id as string;
      expect(returned.body.fine.amountCents).toBe(500);

      const persisted = await dataSource.getRepository(Fine).findOne({
        where: { id: fineId },
      });
      expect(persisted).toMatchObject({
        readerId: reader.id,
        loanId,
        amountCents: 500,
        settledAt: null,
      });

      const settled = await request(app.getHttpServer())
        .patch(`/loans/fines/${fineId}/settle`)
        .set('Authorization', `Bearer ${fineToken}`)
        .expect(200);
      expect((settled.body as { settledAt: string }).settledAt).toBeTruthy();

      const settledPersisted = await dataSource.getRepository(Fine).findOne({
        where: { id: fineId },
      });
      expect(settledPersisted?.settledAt).toBeTruthy();
    });

    it('重复结清被拒绝（400）', async () => {
      const rule = await dataSource.getRepository(LoanRule).findOne({
        where: { readerType: ReaderType.Student },
      });
      if (rule) {
        rule.graceDays = 0;
        rule.fineDailyFeeCents = 100;
        await dataSource.getRepository(LoanRule).save(rule);
      }

      const reader = await seedReader(`CR-RET6-${Date.now()}`);
      const copy = await seedAvailableCopy(`BC-RET6-${Date.now()}`);
      const circulation = await seedLibrarian([Permission.Circulation]);
      const fineManager = await seedLibrarian([Permission.Circulation, Permission.Fine]);
      const circulationToken = await staffToken(circulation);
      const fineToken = await staffToken(fineManager);

      const checkout = await request(app.getHttpServer())
        .post('/loans')
        .set('Authorization', `Bearer ${circulationToken}`)
        .send({ readerCardNumber: reader.cardNumber, barcode: copy.barcode })
        .expect(201);
      const loanId = checkout.body.id as string;

      const loan = await dataSource.getRepository(Loan).findOne({ where: { id: loanId } });
      if (!loan) {
        throw new Error('loan missing');
      }
      loan.borrowedAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
      loan.dueAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      await dataSource.getRepository(Loan).save(loan);

      const returned = await request(app.getHttpServer())
        .post('/loans/return')
        .set('Authorization', `Bearer ${circulationToken}`)
        .send({ barcode: copy.barcode })
        .expect(201);
      const fineId = returned.body.fine.id as string;

      await request(app.getHttpServer())
        .patch(`/loans/fines/${fineId}/settle`)
        .set('Authorization', `Bearer ${fineToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`/loans/fines/${fineId}/settle`)
        .set('Authorization', `Bearer ${fineToken}`)
        .expect(400);
      expect(res.body.message).toBeTruthy();
    });

    it('无罚款权限的馆员结清被拒绝（403）', async () => {
      const rule = await dataSource.getRepository(LoanRule).findOne({
        where: { readerType: ReaderType.Student },
      });
      if (rule) {
        rule.graceDays = 0;
        rule.fineDailyFeeCents = 100;
        await dataSource.getRepository(LoanRule).save(rule);
      }

      const reader = await seedReader(`CR-RET7-${Date.now()}`);
      const copy = await seedAvailableCopy(`BC-RET7-${Date.now()}`);
      const circulation = await seedLibrarian([Permission.Circulation]);
      const noFine = await seedLibrarian([Permission.Circulation]);
      const circulationToken = await staffToken(circulation);
      const noFineToken = await staffToken(noFine);

      const checkout = await request(app.getHttpServer())
        .post('/loans')
        .set('Authorization', `Bearer ${circulationToken}`)
        .send({ readerCardNumber: reader.cardNumber, barcode: copy.barcode })
        .expect(201);
      const loanId = checkout.body.id as string;

      const loan = await dataSource.getRepository(Loan).findOne({ where: { id: loanId } });
      if (!loan) {
        throw new Error('loan missing');
      }
      loan.borrowedAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
      loan.dueAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      await dataSource.getRepository(Loan).save(loan);

      const returned = await request(app.getHttpServer())
        .post('/loans/return')
        .set('Authorization', `Bearer ${circulationToken}`)
        .send({ barcode: copy.barcode })
        .expect(201);
      const fineId = returned.body.fine.id as string;

      const res = await request(app.getHttpServer())
        .patch(`/loans/fines/${fineId}/settle`)
        .set('Authorization', `Bearer ${noFineToken}`)
        .expect(403);
      expect(res.body.message).toBeTruthy();
    });
  });
});
