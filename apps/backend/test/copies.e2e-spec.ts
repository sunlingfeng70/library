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
  constructor(private readonly openidByCode: Map<string, string>) {}

  async exchangeCode(code: string) {
    const openid = this.openidByCode.get(code);
    if (!openid) {
      throw new Error(`unknown code: ${code}`);
    }
    return { openid, unionid: null };
  }
}

describe('copies (e2e)', () => {
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
      username: `cop-lib-${Date.now()}-${Math.random()}`,
      passwordHash: await bcrypt.hash('librarian-password-1', 10),
      role: StaffRole.Librarian,
      permissions,
    });
    return repo.save(staff);
  }

  async function seedReader(): Promise<Reader> {
    const repo = dataSource.getRepository(Reader);
    const reader = repo.create({
      cardNumber: `CR-${Date.now()}`,
      name: '馆藏读者',
      readerType: 'student',
      passwordHash: await bcrypt.hash('reader-password-1', 10),
    });
    return repo.save(reader);
  }

  async function seedRecord(title: string, isbn?: string): Promise<BibliographicRecord> {
    const repo = dataSource.getRepository(BibliographicRecord);
    return repo.save(
      repo.create({
        title,
        isbn: isbn ?? null,
      }),
    );
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
      'TRUNCATE "reader", "staff", "bibliographic_record", "copy" RESTART IDENTITY CASCADE',
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

  describe('AC-1 可为一条书目添加多个副本，每副本独立条码', () => {
    it('为书目添加多个副本成功', async () => {
      const record = await seedRecord('三体', '9787536692930');
      const librarian = await seedLibrarian([Permission.Cataloging]);
      const token = await staffToken(librarian);

      const res = await request(app.getHttpServer())
        .post(`/bibliographic-records/${record.id}/copies`)
        .set('Authorization', `Bearer ${token}`)
        .send({ barcodes: ['BC-001', 'BC-002', 'BC-003'] })
        .expect(201);
      expect(res.body).toHaveLength(3);
      expect(res.body[0]).toMatchObject({ barcode: 'BC-001', status: 'available' });
      expect(res.body[0].bibliographicRecordId).toBe(record.id);
    });

    it('重复条码（请求内）被拒绝（400）', async () => {
      const record = await seedRecord('球状闪电');
      const librarian = await seedLibrarian([Permission.Cataloging]);
      const token = await staffToken(librarian);

      const res = await request(app.getHttpServer())
        .post(`/bibliographic-records/${record.id}/copies`)
        .set('Authorization', `Bearer ${token}`)
        .send({ barcodes: ['BC-DUP', 'BC-DUP'] })
        .expect(400);
      expect(res.body.message).toBeTruthy();
    });

    it('条码与已有副本冲突被拒绝（400）', async () => {
      const record = await seedRecord('朝闻道');
      const librarian = await seedLibrarian([Permission.Cataloging]);
      const token = await staffToken(librarian);

      await request(app.getHttpServer())
        .post(`/bibliographic-records/${record.id}/copies`)
        .set('Authorization', `Bearer ${token}`)
        .send({ barcodes: ['BC-TAKEN'] })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/bibliographic-records/${record.id}/copies`)
        .set('Authorization', `Bearer ${token}`)
        .send({ barcodes: ['BC-TAKEN'] })
        .expect(400);
      expect(res.body.message).toBeTruthy();
    });

    it('书目不存在时添加副本返回 404', async () => {
      const librarian = await seedLibrarian([Permission.Cataloging]);
      const token = await staffToken(librarian);
      const missingId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app.getHttpServer())
        .post(`/bibliographic-records/${missingId}/copies`)
        .set('Authorization', `Bearer ${token}`)
        .send({ barcodes: ['BC-GHOST'] })
        .expect(404);
      expect(res.body.message).toBeTruthy();
    });

    it('无 cataloging 权限的馆员添加副本被拒绝（403）', async () => {
      const record = await seedRecord('诗云');
      const noAccess = await seedLibrarian([Permission.Circulation]);
      const token = await staffToken(noAccess);
      const res = await request(app.getHttpServer())
        .post(`/bibliographic-records/${record.id}/copies`)
        .set('Authorization', `Bearer ${token}`)
        .send({ barcodes: ['BC-NOPERM'] })
        .expect(403);
      expect(res.body.message).toBeTruthy();
    });
  });

  describe('AC-2 副本状态可流转（在馆/破损/下架；在借由流通流程独占）', () => {
    it('状态可在在馆/破损/下架间流转', async () => {
      const record = await seedRecord('带上她的眼睛');
      const librarian = await seedLibrarian([Permission.Cataloging]);
      const token = await staffToken(librarian);

      const created = await request(app.getHttpServer())
        .post(`/bibliographic-records/${record.id}/copies`)
        .set('Authorization', `Bearer ${token}`)
        .send({ barcodes: ['BC-FLOW'] })
        .expect(201);
      const copyId = created.body[0].id as string;

      const damaged = await request(app.getHttpServer())
        .patch(`/copies/${copyId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'damaged' })
        .expect(200);
      expect(damaged.body.status).toBe('damaged');

      const offShelf = await request(app.getHttpServer())
        .patch(`/copies/${copyId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'off_shelf' })
        .expect(200);
      expect(offShelf.body.status).toBe('off_shelf');

      const back = await request(app.getHttpServer())
        .patch(`/copies/${copyId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'available' })
        .expect(200);
      expect(back.body.status).toBe('available');
    });

    it('编目端不可直接设置在借状态（400）', async () => {
      const record = await seedRecord('吞食者');
      const librarian = await seedLibrarian([Permission.Cataloging]);
      const token = await staffToken(librarian);
      const created = await request(app.getHttpServer())
        .post(`/bibliographic-records/${record.id}/copies`)
        .set('Authorization', `Bearer ${token}`)
        .send({ barcodes: ['BC-NOLOAN'] })
        .expect(201);
      const copyId = created.body[0].id as string;

      const res = await request(app.getHttpServer())
        .patch(`/copies/${copyId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'borrowed' })
        .expect(400);
      expect(res.body.message).toBeTruthy();
    });

    it('非法状态值被拒绝（400）', async () => {
      const record = await seedRecord('乡村教师');
      const librarian = await seedLibrarian([Permission.Cataloging]);
      const token = await staffToken(librarian);
      const created = await request(app.getHttpServer())
        .post(`/bibliographic-records/${record.id}/copies`)
        .set('Authorization', `Bearer ${token}`)
        .send({ barcodes: ['BC-BAD'] })
        .expect(201);
      const copyId = created.body[0].id as string;

      const res = await request(app.getHttpServer())
        .patch(`/copies/${copyId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'lost' })
        .expect(400);
      expect(res.body.message).toBeTruthy();
    });
  });

  describe('AC-3 一条书目可查询其名下副本列表与状态', () => {
    it('按书目查询副本列表，含状态', async () => {
      const record = await seedRecord('流浪地球');
      const librarian = await seedLibrarian([Permission.Cataloging]);
      const token = await staffToken(librarian);
      await request(app.getHttpServer())
        .post(`/bibliographic-records/${record.id}/copies`)
        .set('Authorization', `Bearer ${token}`)
        .send({ barcodes: ['BC-L1', 'BC-L2'] })
        .expect(201);

      const readerTokenValue = await readerToken();
      const res = await request(app.getHttpServer())
        .get(`/bibliographic-records/${record.id}/copies`)
        .set('Authorization', `Bearer ${readerTokenValue}`)
        .expect(200);
      expect(res.body).toHaveLength(2);
      expect(res.body.map((c: { barcode: string }) => c.barcode).sort()).toEqual(['BC-L1', 'BC-L2']);
      expect(res.body.every((c: { status: string }) => c.status === 'available')).toBe(true);
    });

    it('书目不存在时查询返回 404', async () => {
      const readerTokenValue = await readerToken();
      const missingId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app.getHttpServer())
        .get(`/bibliographic-records/${missingId}/copies`)
        .set('Authorization', `Bearer ${readerTokenValue}`)
        .expect(404);
      expect(res.body.message).toBeTruthy();
    });
  });

  describe('AC-4 副本状态数据可被后续流通模块消费', () => {
    it('状态以 DB enum 持久化，流通模块可直接读取', async () => {
      const record = await seedRecord('全频带阻塞干扰');
      const librarian = await seedLibrarian([Permission.Cataloging]);
      const token = await staffToken(librarian);
      const created = await request(app.getHttpServer())
        .post(`/bibliographic-records/${record.id}/copies`)
        .set('Authorization', `Bearer ${token}`)
        .send({ barcodes: ['BC-CONSUME'] })
        .expect(201);
      const copyId = created.body[0].id as string;

      await request(app.getHttpServer())
        .patch(`/copies/${copyId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'off_shelf' })
        .expect(200);

      const persisted = await dataSource
        .getRepository(Copy)
        .findOne({ where: { id: copyId } });
      expect(persisted?.status).toBe(CopyStatus.OffShelf);
      expect(persisted?.barcode).toBe('BC-CONSUME');
    });
  });
});