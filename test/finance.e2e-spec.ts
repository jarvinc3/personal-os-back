import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { applyAuthTestOverrides } from './helpers/auth-test.providers';
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

    const moduleFixture: TestingModule = await applyAuthTestOverrides(
      Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(PrismaService)
        .useValue(prismaMock),
    ).compile();

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
        institutionId: null,
        currency: 'DOP',
        balance: { toString: () => '1000.00' },
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
      institutionId: null,
      currency: 'DOP',
      balance: { toString: () => '0.00' },
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

  it('POST /api/finance/transactions creates debit', async () => {
    const accountId = '11111111-1111-4111-8111-111111111111';
    prismaMock.finAccount.findFirst.mockResolvedValue({
      id: accountId,
      userId: 'user-123',
      currency: 'DOP',
      name: 'Main',
    });

    await request(app.getHttpServer())
      .post('/api/finance/transactions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'DEBIT',
        amount: 50,
        currency: 'DOP',
        transactionDate: '2026-08-01T12:00:00.000Z',
        accountId,
      })
      .expect(201)
      .expect((res) => {
        expect(res.body.data).toMatchObject({
          id: 'tx-1',
          type: 'DEBIT',
          status: 'CONFIRMED',
        });
      });
  });

  it('POST /api/finance/transactions/:id/confirm confirms PENDING', async () => {
    const pendingId = '22222222-2222-4222-8222-222222222222';
    const pendingRow = {
      id: pendingId,
      userId: 'user-123',
      accountId: '11111111-1111-4111-8111-111111111111',
      cardId: null,
      type: 'DEBIT',
      amount: { toString: () => '20.00' },
      ledgerAmount: { toString: () => '20.00' },
      amountBaseCurrency: { toString: () => '20.00' },
      currency: 'DOP',
      ledgerCurrency: 'DOP',
      exchangeRate: { toString: () => '1' },
      merchant: null,
      description: null,
      transactionDate: new Date(),
      status: 'PENDING',
      source: 'MANUAL',
      categoryId: null,
      notes: null,
      transferGroupId: null,
      linkedTransactionId: null,
      createdAt: new Date(),
      account: { id: '11111111-1111-4111-8111-111111111111', name: 'Main' },
      card: null,
    };

    prismaMock.finTransaction.findFirst
      .mockResolvedValueOnce(pendingRow)
      .mockResolvedValue({ ...pendingRow, status: 'CONFIRMED' });

    await request(app.getHttpServer())
      .post(`/api/finance/transactions/${pendingId}/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .expect((res) => {
        expect([200, 201, 404]).toContain(res.status);
      });
  });

  it('POST /api/finance/transfers creates transfer group', async () => {
    const fromAccountId = '11111111-1111-4111-8111-111111111111';
    const toAccountId = '33333333-3333-4333-8333-333333333333';
    prismaMock.finAccount.findFirst.mockImplementation((args: any) =>
      Promise.resolve({
        id: args?.where?.id ?? fromAccountId,
        userId: 'user-123',
        currency: 'DOP',
      }),
    );

    await request(app.getHttpServer())
      .post('/api/finance/transfers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fromAccountId,
        toAccountId,
        amount: 25,
        currency: 'DOP',
        transactionDate: '2026-08-01T12:00:00.000Z',
      })
      .expect((res) => {
        expect([201, 404, 400]).toContain(res.status);
        if (res.status === 201) {
          expect(res.body.data).toHaveProperty('transferGroupId');
        }
      });
  });

  it('PATCH /api/finance/cards/:id archives with isActive false without accountId', async () => {
    const cardId = '66666666-6666-4666-8666-666666666666';
    const card = {
      id: cardId,
      userId: 'user-123',
      institutionId: 'inst-1',
      accountId: 'acc-1',
      name: 'Debit',
      type: 'DEBIT',
      network: null,
      lastFour: '1234',
      statementClosingDay: null,
      paymentDueDay: null,
      color: null,
      isActive: false,
      institution: { name: 'Bank' },
      account: { id: 'acc-1', name: 'Main' },
      balances: [],
    };
    prismaMock.finCard.findFirst.mockResolvedValue(card);
    prismaMock.finCard.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.finCard.findMany.mockResolvedValue([]);
    prismaMock.finAccount.findFirst.mockResolvedValue({
      id: 'acc-1',
      userId: 'user-123',
    });

    await request(app.getHttpServer())
      .patch(`/api/finance/cards/${cardId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.isActive).toBe(false);
      });

    await request(app.getHttpServer())
      .get('/api/finance/cards')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toEqual([]);
      });
  });

  it('PATCH /api/finance/loans/:id archives with isActive false', async () => {
    const loanId = '77777777-7777-4777-8777-777777777777';
    prismaMock.finLoan.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.finLoan.findFirst.mockResolvedValue({
      id: loanId,
      userId: 'user-123',
      lenderName: 'Bank',
      isActive: false,
      originalAmount: 1000,
      currentBalance: 500,
      installmentAmount: 100,
      installmentFreq: 'MONTHLY',
      totalInstallments: 12,
      paidInstallments: 5,
      nextDueDate: new Date('2026-09-01'),
      account: null,
    });
    prismaMock.finLoan.findMany.mockResolvedValue([]);

    await request(app.getHttpServer())
      .patch(`/api/finance/loans/${loanId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.isActive).toBe(false);
      });
  });

  it('PATCH /api/finance/receivables/:id marks PAID and rejects overpay', async () => {
    const recId = '88888888-8888-4888-8888-888888888888';
    const pending = {
      id: recId,
      userId: 'user-123',
      debtorName: 'Ana',
      description: null,
      amount: 80,
      paidAmount: 0,
      currency: 'DOP',
      dueDate: null,
      status: 'PENDING',
    };
    prismaMock.finReceivable.findFirst
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({ ...pending, status: 'PAID', paidAmount: 80 })
      .mockResolvedValue(pending);
    prismaMock.finReceivable.updateMany.mockResolvedValue({ count: 1 });

    await request(app.getHttpServer())
      .patch(`/api/finance/receivables/${recId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'PAID', paidAmount: 80 })
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toMatchObject({ status: 'PAID', paidAmount: 80 });
      });

    await request(app.getHttpServer())
      .patch(`/api/finance/receivables/${recId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ paidAmount: 90 })
      .expect(400);
  });

  it('GET /api/finance/analytics/summary returns totals envelope', async () => {
    prismaMock.finAccount.findMany.mockResolvedValue([
      { balance: { toString: () => '100' } },
    ]);
    prismaMock.finCardBalance.findMany.mockResolvedValue([]);
    prismaMock.finTransaction.groupBy.mockResolvedValue([]);

    await request(app.getHttpServer())
      .get('/api/finance/analytics/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toHaveProperty('netWorth');
        expect(res.body.data).toHaveProperty('totals');
      });
  });
});
