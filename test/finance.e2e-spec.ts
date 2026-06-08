import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestJwt } from './helpers/jwt.helper';
import { createPrismaMock } from './helpers/prisma.mock';
import { applyTestEnv } from './helpers/test-env';

applyTestEnv();

describe('Finance (e2e)', () => {
  let app: INestApplication<App>;
  let prismaMock: ReturnType<typeof createPrismaMock>;
  let token: string;

  beforeEach(async () => {
    const { AppModule } = require('../src/app.module') as {
      AppModule: new (...args: never[]) => unknown;
    };
    prismaMock = createPrismaMock();
    token = createTestJwt({ sub: 'user-123' });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('GET /api/finance/accounts returns accounts', async () => {
    prismaMock.finAccount.findMany.mockResolvedValue([
      {
        id: 'acc-1',
        userId: 'user-123',
        name: 'Main',
        type: 'CHECKING',
        institution: null,
        currency: 'DOP',
        balance: { toString: () => '1000.00' },
        creditLimit: null,
        statementClosingDay: null,
        paymentDueDay: null,
        color: null,
        isActive: true,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      },
    ]);

    await request(app.getHttpServer())
      .get('/api/finance/accounts')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toMatchObject({
          id: 'acc-1',
          name: 'Main',
          balance: '1000.00',
        });
      });
  });

  it('POST /api/finance/accounts creates account', async () => {
    prismaMock.finAccount.create.mockResolvedValue({
      id: 'acc-new',
      userId: 'user-123',
      name: 'Savings',
      type: 'SAVINGS',
      institution: 'Bank',
      currency: 'DOP',
      balance: { toString: () => '0.00' },
      creditLimit: null,
      statementClosingDay: null,
      paymentDueDay: null,
      color: '#fff',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await request(app.getHttpServer())
      .post('/api/finance/accounts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Savings',
        type: 'SAVINGS',
        institution: 'Bank',
      })
      .expect(201)
      .expect((res) => {
        expect(res.body.data.name).toBe('Savings');
      });
  });

  it('GET /api/finance/email-sync/oauth/google/url includes accountId in state', async () => {
    const accountId = '11111111-1111-4111-8111-111111111111';
    prismaMock.finAccount.findFirst.mockResolvedValue({
      id: accountId,
      userId: 'user-123',
    });

    await request(app.getHttpServer())
      .get('/api/finance/email-sync/oauth/google/url')
      .query({ bankDomain: 'qik.com.do', accountId })
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data.url).toContain('accounts.google.com');
        expect(res.body.data.url).toContain('state=');
      });
  });

  it('PATCH /api/finance/email-sync/sources/:id links account', async () => {
    const sourceId = 'src-1';
    const accountId = '11111111-1111-4111-8111-111111111111';
    const updatedSource = {
      id: sourceId,
      userId: 'user-123',
      emailAddress: 'user@gmail.com',
      bankDomain: 'bhd.com.do',
      label: 'BHD principal',
      accountId,
      provider: 'gmail',
      isActive: true,
      lastSyncedAt: null,
      createdAt: new Date('2026-01-01'),
      logs: [],
    };

    prismaMock.finAccount.findFirst.mockResolvedValue({
      id: accountId,
      userId: 'user-123',
    });
    prismaMock.finEmailSource.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.finEmailSource.findFirst.mockResolvedValue(updatedSource);

    await request(app.getHttpServer())
      .patch(`/api/finance/email-sync/sources/${sourceId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ accountId, label: 'BHD principal' })
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toMatchObject({
          id: sourceId,
          accountId,
          label: 'BHD principal',
        });
        expect(res.body.data).not.toHaveProperty('accessToken');
        expect(res.body.data.logs).toEqual([]);
      });
  });

  it('GET /api/finance/email-sync/oauth/google/callback ignores extra Google query params', async () => {
    await request(app.getHttpServer())
      .get('/api/finance/email-sync/oauth/google/callback')
      .query({
        code: 'test-auth-code',
        state: 'invalid-state',
        iss: 'https://accounts.google.com',
        scope: 'email https://www.googleapis.com/auth/gmail.readonly',
        authuser: '0',
        prompt: 'consent',
      })
      .expect(302)
      .expect('Location', 'personal-os://finance/oauth/callback?success=false');
  });

  it('POST /api/finance/email-sync/sources/:id/sync returns queued false without Redis', async () => {
    prismaMock.finEmailSource.findFirst.mockResolvedValue({
      id: 'src-1',
      userId: 'user-123',
      accountId: 'acc-1',
    });

    await request(app.getHttpServer())
      .post('/api/finance/email-sync/sources/src-1/sync')
      .set('Authorization', `Bearer ${token}`)
      .expect(201)
      .expect((res) => {
        expect(res.body.data).toMatchObject({ queued: false });
        expect(res.body.data.reason).toContain('gmail-sync queue is unavailable');
      });
  });
});
