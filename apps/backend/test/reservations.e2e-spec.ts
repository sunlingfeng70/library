import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { WechatService } from '../src/auth/wechat.service';
import { BibliographicRecord } from '../src/bibliographic-records/bibliographic-record.entity';
import { Copy, CopyStatus } from '../src/copies/copy.entity';
import { migrationDataSourceOptions } from '../src/database/database-options';
import { Reader } from '../src/readers/reader.entity';
import { Permission, Staff, StaffRole } from '../src/staff/staff.entity';

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';

class FakeWechatService implements WechatService {
  private readonly openidByCode: Map<string, string>;
  constructor(codes: Map<string, string>) {
    this.openidByCode = codes;
  }

  async exchangeCode(code: string) {
    const openid = this.openidByCode.get(code);
    if (!openid) {
      throw new Error(`unknown code: ${code}`);
    }
    return { openid, unionid: null };
  }
}

describe('reservations (e2e)', () => {
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
      username: `resv-lib-${Date.now()}-${Math.random()}`,
      passwordHash: await bcrypt.hash('librarian-password-1', 10),
      role: StaffRole.Librarian,
      permissions,
    });
    return repo.save(staff);
  }

  async function seedAdmin(): Promise<Staff> {
    const repo = dataSource.getRepository(Staff);
    const staff = repo.create({
      username: `resv-adm-${Date.now()}-${Math.random()}`,
      passwordHash: await bcrypt.hash('librarian-password-1', 10),
      role: StaffRole.Administrator,
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

  async function seedReader(cardNumber: string): Promise<Reader> {
    const repo = dataSource.getRepository(Reader);
    const reader = repo.create({
      cardNumber,
      name: '预约读者',
      readerType: 'student',
      passwordHash: await bcrypt.hash('reader-password-1', 10),
    });
    return repo.save(reader);
  }

  async function readerToken(reader: Reader): Promise<string> {
    const code = `resv-reader-code-${Date.now()}-${Math.random()}`;
    openidByCode.set(code, `resv-reader-openid-${Date.now()}-${Math.random()}`);
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
    const record = dataSource.getRepository(BibliographicRecord).create({
      title: `预约测试-${barcode}`,
    });
    const saved = await dataSource.getRepository(BibliographicRecord).save(record);
    return dataSource.getRepository(Copy).save(
      dataSource.getRepository(Copy).create({
        barcode,
        status: CopyStatus.Available,
        bibliographicRecordId: saved.id,
      }),
    );
  }

  async function circulationToken(): Promise<string> {
    const lib = await seedLibrarian([Permission.Circulation]);
    return staffToken(lib);
  }

  async function lendCopy(reader: Reader, copy: Copy): Promise<void> {
    const token = await circulationToken();
    await request(app.getHttpServer())
      .post('/loans')
      .set('Authorization', `Bearer ${token}`)
      .send({ readerCardNumber: reader.cardNumber, barcode: copy.barcode })
      .expect(201);
  }

  async function returnCopy(copy: Copy): Promise<void> {
    const token = await circulationToken();
    await request(app.getHttpServer())
      .post('/loans/return')
      .set('Authorization', `Bearer ${token}`)
      .send({ barcode: copy.barcode })
      .expect(201);
  }

  async function reserve(
    token: string,
    copy: Copy,
    expectCode = 201,
  ): Promise<{ id: string; status: string; pickupDeadline: string | null }> {
    const res = await request(app.getHttpServer())
      .post('/reservations')
      .set('Authorization', `Bearer ${token}`)
      .send({ copyId: copy.id })
      .expect(expectCode);
    return res.body as { id: string; status: string; pickupDeadline: string | null };
  }

  async function myReservation(
    token: string,
    copy: Copy,
  ): Promise<{
    id: string;
    copyId: string;
    status: string;
    pickupDeadline: string | null;
    cancelledReason: string | null;
  }> {
    const res = await request(app.getHttpServer())
      .get('/reservations/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const rows = res.body as Array<{
      id: string;
      copyId: string;
      status: string;
      pickupDeadline: string | null;
      cancelledReason: string | null;
    }>;
    const row = rows.find((r) => r.copyId === copy.id);
    if (!row) {
      throw new Error(`no reservation for copy ${copy.id}`);
    }
    return row;
  }

  beforeAll(async () => {
    await ensureTestDatabase();
    dataSource = new DataSource(migrationDataSourceOptions(process.env));
    await dataSource.initialize();
    await dataSource.runMigrations();
    await dataSource.query(
      'TRUNCATE "loan", "loan_rule", "reader", "staff", "bibliographic_record", "copy", "reservation" RESTART IDENTITY CASCADE',
    );
    await dataSource.query(`
      INSERT INTO "loan_rule" ("reader_type", "max_active_loans", "loan_duration_days", "fine_daily_fee_cents", "grace_days", "renewal_limit") VALUES
        ('student', 5, 30, 50, 3, 1)
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
    await dataSource?.query(`UPDATE "institution_config" SET "reservation_enabled" = true`);
    await app?.close();
    await dataSource?.destroy();
  });

  describe('AC-1 读者可对在借副本发起预约（机构开启）', () => {
    it('读者可预约在借副本，返回 pending', async () => {
      const reader = await seedReader(`RV1-R-${Date.now()}`);
      const copy = await seedAvailableCopy(`BC-RV1-${Date.now()}`);
      const token = await readerToken(reader);
      await lendCopy(reader, copy);

      const res = await reserve(token, copy);
      expect(res).toMatchObject({ status: 'pending', pickupDeadline: null });
    });

    it('重复预约同一副本被拒绝（400）', async () => {
      const reader = await seedReader(`CR1-R-${Date.now()}`);
      const copy = await seedAvailableCopy(`BC-CR1-${Date.now()}`);
      const token = await readerToken(reader);
      await lendCopy(reader, copy);

      await reserve(token, copy);
      const res = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${token}`)
        .send({ copyId: copy.id })
        .expect(400);
      expect(res.body.message).toContain('无需重复预约');
    });

    it('不可预约当前在馆的副本（400）', async () => {
      const reader = await seedReader(`READY-R-${Date.now()}`);
      const copy = await seedAvailableCopy(`BC-READY-${Date.now()}`);
      const token = await readerToken(reader);

      const res = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${token}`)
        .send({ copyId: copy.id })
        .expect(400);
      expect(res.body.message).toContain('在借');
    });
  });

  describe('AC-2 预约队列 FIFO 分配，归还后通知下一位', () => {
    it('归还后最早预约者获得 allocated，副本进入 on_hold，后者仍 pending', async () => {
      const first = await seedReader(`FIFO1A-R-${Date.now()}`);
      const second = await seedReader(`FIFO1B-R-${Date.now()}`);
      const copy = await seedAvailableCopy(`BC-FIFO1-${Date.now()}`);
      const tokenFirst = await readerToken(first);
      const tokenSecond = await readerToken(second);
      await lendCopy(first, copy);

      await reserve(tokenFirst, copy);
      await reserve(tokenSecond, copy);

      await returnCopy(copy);

      const held = await dataSource.getRepository(Copy).findOne({ where: { id: copy.id } });
      expect(held?.status).toBe(CopyStatus.OnHold);

      const firstRow = await myReservation(tokenFirst, copy);
      expect(firstRow.status).toBe('allocated');
      expect(firstRow.pickupDeadline).toBeTruthy();

      const secondRow = await myReservation(tokenSecond, copy);
      expect(secondRow.status).toBe('pending');
    });

    it('无预约时归还后回到 available', async () => {
      const reader = await seedReader(`NA-R-${Date.now()}`);
      const copy = await seedAvailableCopy(`BC-NA-${Date.now()}`);
      const token = await readerToken(reader);
      await lendCopy(reader, copy);

      await returnCopy(copy);

      const held = await dataSource.getRepository(Copy).findOne({ where: { id: copy.id } });
      expect(held?.status).toBe(CopyStatus.Available);
    });

    it('持有到书预约者可借出 on_hold 副本并标记 fulfilled', async () => {
      const reader = await seedReader(`HOLD-R-${Date.now()}`);
      const copy = await seedAvailableCopy(`BC-HOLD-${Date.now()}`);
      const token = await readerToken(reader);
      await lendCopy(reader, copy);
      await reserve(token, copy);
      await returnCopy(copy);

      const held = await dataSource.getRepository(Copy).findOne({ where: { id: copy.id } });
      expect(held?.status).toBe(CopyStatus.OnHold);

      const libToken = await circulationToken();
      await request(app.getHttpServer())
        .post('/loans')
        .set('Authorization', `Bearer ${libToken}`)
        .send({ readerCardNumber: reader.cardNumber, barcode: copy.barcode })
        .expect(201);

      const row = await myReservation(token, copy);
      expect(row.status).toBe('fulfilled');
    });

    it('非预约持有者不可借出 on_hold 副本（400）', async () => {
      const holder = await seedReader(`HOLDER-R-${Date.now()}`);
      const other = await seedReader(`OTHER-R-${Date.now()}`);
      const copy = await seedAvailableCopy(`BC-HOLDER-${Date.now()}`);
      const holderToken = await readerToken(holder);
      const otherToken = await readerToken(other);
      await lendCopy(holder, copy);
      await reserve(holderToken, copy);
      await returnCopy(copy);

      const held = await dataSource.getRepository(Copy).findOne({ where: { id: copy.id } });
      expect(held?.status).toBe(CopyStatus.OnHold);

      const libToken = await circulationToken();
      const res = await request(app.getHttpServer())
        .post('/loans')
        .set('Authorization', `Bearer ${libToken}`)
        .send({ readerCardNumber: other.cardNumber, barcode: copy.barcode })
        .expect(400);
      expect(res.body.message).toContain('预约保留');
    });
  });

  describe('AC-3 机构关闭预约时不提供预约能力', () => {
    it('关闭后创建被拒绝，开启后恢复', async () => {
      const admin = await seedAdmin();
      const adminToken = await staffToken(admin);
      await request(app.getHttpServer())
        .put('/admin/institution')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reservationEnabled: false })
        .expect(200);

      const cap = await request(app.getHttpServer())
        .get('/reservations/capability')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(cap.body.enabled).toBe(false);

      const reader = await seedReader(`DIS-R-${Date.now()}`);
      const copy = await seedAvailableCopy(`BC-CAP-${Date.now()}`);
      const token = await readerToken(reader);
      await lendCopy(reader, copy);
      const res = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${token}`)
        .send({ copyId: copy.id })
        .expect(400);
      expect(res.body.message).toContain('未开通预约');

      await request(app.getHttpServer())
        .put('/admin/institution')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reservationEnabled: true })
        .expect(200);
    });
  });

  describe('AC-4 预约到书后定时未领自动取消', () => {
    it('超时预约自动取消，副本回到 available', async () => {
      const reader = await seedReader(`EXP-R-${Date.now()}`);
      const copy = await seedAvailableCopy(`BC-EXP-${Date.now()}`);
      const token = await readerToken(reader);
      await lendCopy(reader, copy);
      const created = await reserve(token, copy);
      await returnCopy(copy);

      const held = await dataSource.getRepository(Copy).findOne({ where: { id: copy.id } });
      expect(held?.status).toBe(CopyStatus.OnHold);

      await dataSource.query(
        `UPDATE "reservation" SET "pickup_deadline" = now() - interval '1 day' WHERE "id" = $1`,
        [created.id],
      );

      const row = await myReservation(token, copy);
      expect(row.status).toBe('cancelled');
      expect(row.cancelledReason).toBe('超时未领取');

      const after = await dataSource.getRepository(Copy).findOne({ where: { id: copy.id } });
      expect(after?.status).toBe(CopyStatus.Available);
    });
  });
});
