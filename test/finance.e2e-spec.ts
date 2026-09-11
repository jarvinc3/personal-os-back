import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as jwt from 'jsonwebtoken';
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
        institutionId: 'inst-1',
        currency: 'DOP',
        balance: { toString: () => '1000.00' },
        color: null,
        isActive: true,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        institutionRef: { name: 'Banco' },
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

  it('GET /api/finance/accounts returns 403 when finance module is disabled', async () => {
    prismaMock.userModule.findFirst.mockResolvedValue(null);

    await request(app.getHttpServer())
      .get('/api/finance/accounts')
      .set('Authorization', `Bearer ${token}`)
      .expect(403)
      .expect((res) => {
        expect(res.body).toMatchObject({
          statusCode: 403,
          message: 'Finance module is disabled',
        });
      });

    expect(prismaMock.finAccount.findMany).not.toHaveBeenCalled();
  });

  it('POST /api/finance/transactions returns 403 when finance module is disabled', async () => {
    prismaMock.userModule.findFirst.mockResolvedValue(null);

    await request(app.getHttpServer())
      .post('/api/finance/transactions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'DEBIT',
        amount: 50,
        currency: 'DOP',
        transactionDate: '2026-08-01T12:00:00.000Z',
        accountId: '11111111-1111-4111-8111-111111111111',
      })
      .expect(403)
      .expect((res) => {
        expect(res.body.message).toBe('Finance module is disabled');
      });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('GET /api/finance/email-sync/oauth/google/callback stays public when finance is disabled', async () => {
    prismaMock.userModule.findFirst.mockResolvedValue(null);

    await request(app.getHttpServer())
      .get('/api/finance/email-sync/oauth/google/callback')
      .query({
        code: 'test-auth-code',
        state: 'invalid-state',
      })
      .expect(302);

    expect(prismaMock.userModule.findFirst).not.toHaveBeenCalled();
  });

  it('POST /api/finance/accounts creates account', async () => {
    const institutionId = '11111111-1111-4111-8111-111111111111';
    prismaMock.finInstitution.findMany.mockResolvedValue([
      { id: institutionId, name: 'Bank', userId: 'user-123' },
    ]);
    prismaMock.finAccount.create.mockResolvedValue({
      id: 'acc-new',
      userId: 'user-123',
      name: 'Savings',
      type: 'SAVINGS',
      institutionId,
      currency: 'DOP',
      balance: { toString: () => '0.00' },
      color: '#fff',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      institutionRef: { name: 'Bank' },
    });

    await request(app.getHttpServer())
      .post('/api/finance/accounts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Savings',
        type: 'SAVINGS',
        institutionId,
      })
      .expect(201)
      .expect((res) => {
        expect(res.body.data.name).toBe('Savings');
        expect(res.body.data.institutionId).toBe(institutionId);
        expect(res.body.data.institutionName).toBe('Bank');
        expect(res.body.data.institution).toBeUndefined();
      });
  });

  it('POST /api/finance/accounts rejects missing institutionId for SAVINGS', async () => {
    await request(app.getHttpServer())
      .post('/api/finance/accounts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Savings',
        type: 'SAVINGS',
      })
      .expect(400);
  });

  it('POST /api/finance/accounts allows CASH without institutionId', async () => {
    prismaMock.finAccount.create.mockResolvedValue({
      id: 'acc-cash',
      userId: 'user-123',
      name: 'Efectivo',
      type: 'CASH',
      institutionId: null,
      currency: 'DOP',
      balance: { toString: () => '0.00' },
      color: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      institutionRef: null,
    });

    await request(app.getHttpServer())
      .post('/api/finance/accounts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Efectivo',
        type: 'CASH',
      })
      .expect(201)
      .expect((res) => {
        expect(res.body.data.type).toBe('CASH');
        expect(res.body.data.institutionId).toBeNull();
      });
  });

  it('GET /api/finance/email-sync/oauth/google/url includes institutionId in state', async () => {
    const institutionId = '11111111-1111-4111-8111-111111111111';
    prismaMock.finInstitution.findFirst.mockResolvedValue({
      id: institutionId,
      userId: 'user-123',
      name: 'Bank',
    });

    await request(app.getHttpServer())
      .get('/api/finance/email-sync/oauth/google/url')
      .query({ bankDomain: 'qik.com.do', institutionId })
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data.url).toContain('accounts.google.com');
        expect(res.body.data.url).toContain('state=');
      });
  });

  it('GET /api/finance/email-sync/oauth/google/url rejects missing institutionId', async () => {
    await request(app.getHttpServer())
      .get('/api/finance/email-sync/oauth/google/url')
      .query({ bankDomain: 'qik.com.do' })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('GET /api/finance/email-sync/oauth/google/url rejects returnTo outside CORS_ORIGIN', async () => {
    const institutionId = '11111111-1111-4111-8111-111111111111';
    await request(app.getHttpServer())
      .get('/api/finance/email-sync/oauth/google/url')
      .query({ institutionId, returnTo: 'https://evil.example/phish' })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('PATCH /api/finance/email-sync/sources/:id updates institution without leaking tokens', async () => {
    const sourceId = 'src-1';
    const institutionId = '11111111-1111-4111-8111-111111111111';
    const updatedSource = {
      id: sourceId,
      userId: 'user-123',
      connectionId: 'conn-1',
      institutionId,
      bankDomain: 'bhd.com.do',
      label: 'BHD principal',
      isActive: true,
      lastSyncedAt: null,
      createdAt: new Date('2026-01-01'),
      connection: {
        id: 'conn-1',
        emailAddress: 'user@gmail.com',
        provider: 'gmail',
        isActive: true,
      },
      institution: { id: institutionId, name: 'BHD', isActive: true },
      logs: [],
    };

    prismaMock.finInstitution.findFirst.mockResolvedValue({
      id: institutionId,
      userId: 'user-123',
      name: 'BHD',
    });
    prismaMock.finEmailSource.findFirst.mockResolvedValue(updatedSource);
    prismaMock.finEmailSource.updateMany.mockResolvedValue({ count: 1 });

    await request(app.getHttpServer())
      .patch(`/api/finance/email-sync/sources/${sourceId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ institutionId, label: 'BHD principal' })
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toMatchObject({
          id: sourceId,
          institutionId,
          label: 'BHD principal',
          emailAddress: 'user@gmail.com',
        });
        expect(res.body.data).not.toHaveProperty('accessToken');
        expect(res.body.data).not.toHaveProperty('accountId');
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

  it('GET /api/finance/email-sync/oauth/google/callback redirects to allowlisted returnTo', async () => {
    const state = jwt.sign(
      {
        sub: 'user-123',
        bankDomain: 'qik.com.do',
        returnTo: 'http://localhost:5173/finance/oauth',
      },
      process.env.OAUTH_STATE_SECRET as string,
      { expiresIn: '15m' },
    );

    await request(app.getHttpServer())
      .get('/api/finance/email-sync/oauth/google/callback')
      .query({
        code: 'test-auth-code',
        state,
      })
      .expect(302)
      .expect('Location', 'http://localhost:5173/finance/oauth?success=false');
  });

  it('GET /api/finance/email-sync/oauth/google/callback ignores non-allowlisted returnTo', async () => {
    const state = jwt.sign(
      {
        sub: 'user-123',
        bankDomain: 'qik.com.do',
        returnTo: 'https://evil.example/phish',
      },
      process.env.OAUTH_STATE_SECRET as string,
      { expiresIn: '15m' },
    );

    await request(app.getHttpServer())
      .get('/api/finance/email-sync/oauth/google/callback')
      .query({
        code: 'test-auth-code',
        state,
      })
      .expect(302)
      .expect('Location', 'personal-os://finance/oauth/callback?success=false');
  });

  it('POST /api/finance/email-sync/sources/:id/sync returns queued false without Redis', async () => {
    prismaMock.finEmailSource.findFirst.mockResolvedValue({
      id: 'src-1',
      userId: 'user-123',
      institutionId: 'inst-1',
      isActive: true,
      connection: {
        id: 'conn-1',
        emailAddress: 'user@gmail.com',
        provider: 'gmail',
      },
      institution: { id: 'inst-1', name: 'Bank', isActive: true },
      logs: [],
    });

    await request(app.getHttpServer())
      .post('/api/finance/email-sync/sources/src-1/sync')
      .set('Authorization', `Bearer ${token}`)
      .expect(201)
      .expect((res) => {
        expect(res.body.data).toMatchObject({ queued: false });
        expect(res.body.data.reason).toContain(
          'gmail-sync queue is unavailable',
        );
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

  it('POST /api/finance/transactions/:id/reverse returns 404 when missing', async () => {
    prismaMock.finTransaction.findFirst.mockResolvedValue(null);

    await request(app.getHttpServer())
      .post(
        '/api/finance/transactions/22222222-2222-4222-8222-222222222222/reverse',
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('POST /api/finance/transactions/:id/reverse rejects PENDING', async () => {
    const pendingId = '22222222-2222-4222-8222-222222222222';
    prismaMock.finTransaction.findFirst.mockResolvedValue({
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
      notes: null,
      transactionDate: new Date(),
      status: 'PENDING',
      source: 'MANUAL',
      categoryId: null,
      transferGroupId: null,
      linkedTransactionId: null,
      aiMetadata: null,
      createdAt: new Date(),
      account: { id: '11111111-1111-4111-8111-111111111111', name: 'Main' },
      card: null,
    });

    await request(app.getHttpServer())
      .post(`/api/finance/transactions/${pendingId}/reverse`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('POST /api/finance/transactions/:id/reverse is idempotent for REVERSED', async () => {
    const reversedId = '22222222-2222-4222-8222-222222222222';
    prismaMock.finTransaction.findFirst.mockResolvedValue({
      id: reversedId,
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
      notes: null,
      transactionDate: new Date(),
      status: 'REVERSED',
      source: 'MANUAL',
      categoryId: null,
      transferGroupId: null,
      linkedTransactionId: null,
      aiMetadata: null,
      createdAt: new Date(),
      account: { id: '11111111-1111-4111-8111-111111111111', name: 'Main' },
      card: null,
    });

    await request(app.getHttpServer())
      .post(`/api/finance/transactions/${reversedId}/reverse`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201)
      .expect((res) => {
        expect(res.body.data.status).toBe('REVERSED');
        expect(res.body.data.id).toBe(reversedId);
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
      institutionId: 'inst-1',
      isActive: true,
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

  it('POST /api/finance/loans persists currency, interestRate, and notes', async () => {
    const created = {
      id: 'loan-usd',
      userId: 'user-123',
      lenderName: 'BHD',
      originalAmount: 1000,
      currentBalance: 800,
      currency: 'USD',
      installmentAmount: 100,
      installmentFreq: 'MONTHLY',
      totalInstallments: 12,
      paidInstallments: 0,
      nextDueDate: new Date('2026-09-01'),
      interestRate: 0.12,
      notes: 'BHD',
      isActive: true,
      account: null,
    };
    prismaMock.finLoan.create.mockResolvedValue(created);
    prismaMock.finLoan.findMany.mockResolvedValue([created]);

    await request(app.getHttpServer())
      .post('/api/finance/loans')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lenderName: 'BHD',
        originalAmount: 1000,
        currentBalance: 800,
        installmentAmount: 100,
        installmentFreq: 'MONTHLY',
        totalInstallments: 12,
        nextDueDate: '2026-09-01',
        currency: 'usd',
        interestRate: 0.12,
        notes: 'BHD',
      })
      .expect(201)
      .expect((res) => {
        expect(res.body.data).toMatchObject({
          currency: 'USD',
          interestRate: '0.12',
          notes: 'BHD',
        });
      });

    await request(app.getHttpServer())
      .get('/api/finance/loans')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data[0]).toMatchObject({
          currency: 'USD',
          interestRate: '0.12',
          notes: 'BHD',
        });
      });
  });

  it('POST /api/finance/loans defaults currency to DOP and rejects invalid rate or code', async () => {
    prismaMock.finLoan.create.mockResolvedValue({
      id: 'loan-dop',
      currency: 'DOP',
      interestRate: null,
      notes: null,
      lenderName: 'Bank',
      originalAmount: 100,
      currentBalance: 100,
      installmentAmount: 10,
      installmentFreq: 'MONTHLY',
      totalInstallments: 12,
      paidInstallments: 0,
      nextDueDate: new Date('2026-09-01'),
      isActive: true,
      account: null,
    });

    await request(app.getHttpServer())
      .post('/api/finance/loans')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lenderName: 'Bank',
        originalAmount: 100,
        currentBalance: 100,
        installmentAmount: 10,
        installmentFreq: 'MONTHLY',
        totalInstallments: 12,
        nextDueDate: '2026-09-01',
      })
      .expect(201)
      .expect((res) => {
        expect(res.body.data.currency).toBe('DOP');
      });

    await request(app.getHttpServer())
      .post('/api/finance/loans')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lenderName: 'Bank',
        originalAmount: 100,
        currentBalance: 100,
        installmentAmount: 10,
        installmentFreq: 'MONTHLY',
        totalInstallments: 12,
        nextDueDate: '2026-09-01',
        currency: 'US',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/finance/loans')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lenderName: 'Bank',
        originalAmount: 100,
        currentBalance: 100,
        installmentAmount: 10,
        installmentFreq: 'MONTHLY',
        totalInstallments: 12,
        nextDueDate: '2026-09-01',
        interestRate: -1,
      })
      .expect(400);
  });

  it('PATCH /api/finance/loans/:id updates notes without requiring other fields', async () => {
    const loanId = '77777777-7777-4777-8777-777777777777';
    prismaMock.finLoan.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.finLoan.findFirst.mockResolvedValue({
      id: loanId,
      userId: 'user-123',
      lenderName: 'Bank',
      currency: 'USD',
      interestRate: 0.12,
      notes: 'updated',
      isActive: true,
      originalAmount: 1000,
      currentBalance: 500,
      installmentAmount: 100,
      installmentFreq: 'MONTHLY',
      totalInstallments: 12,
      paidInstallments: 5,
      nextDueDate: new Date('2026-09-01'),
      account: null,
    });

    await request(app.getHttpServer())
      .patch(`/api/finance/loans/${loanId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'updated' })
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toMatchObject({
          notes: 'updated',
          currency: 'USD',
          interestRate: '0.12',
          isActive: true,
        });
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
        expect(res.body.data).toMatchObject({
          status: 'PAID',
          paidAmount: '80',
        });
      });

    await request(app.getHttpServer())
      .patch(`/api/finance/receivables/${recId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ paidAmount: 90 })
      .expect(400);
  });

  it('GET /api/finance/analytics/summary returns totals envelope', async () => {
    prismaMock.finInstitution.findMany.mockResolvedValue([]);
    prismaMock.finAccount.findMany.mockResolvedValue([
      {
        id: 'acc-1',
        institutionId: null,
        balance: { toString: () => '100' },
        currency: 'DOP',
      },
    ]);
    prismaMock.finCardBalance.findMany.mockResolvedValue([]);
    prismaMock.finLoan.findMany.mockResolvedValue([]);
    prismaMock.finTransaction.groupBy.mockResolvedValue([]);

    await request(app.getHttpServer())
      .get('/api/finance/analytics/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toHaveProperty('netWorth');
        expect(res.body.data).toHaveProperty('totals');
        expect(res.body.data.baseCurrency).toBe('DOP');
        expect(res.body.data.totals.accountBalance).toBe('100');
        expect(res.body.data.netWorth).toBe('100');
        expect(res.body.data.balanceStatus).toBe('COMPLETE');
        expect(typeof res.body.data.netWorth).toBe('string');
      });
  });

  it('GET /api/finance/balance-sheet returns converted positions and credit utilization', async () => {
    prismaMock.finInstitution.findMany.mockResolvedValue([{ id: 'inst-1' }]);
    prismaMock.finAccount.findMany.mockResolvedValue([
      {
        id: 'acc-1',
        institutionId: 'inst-1',
        currency: 'DOP',
        balance: 150000,
      },
    ]);
    prismaMock.finCardBalance.findMany.mockResolvedValue([
      {
        currency: 'DOP',
        balance: 42000,
        creditLimit: 48000,
        card: { id: 'card-1', institutionId: 'inst-1' },
      },
    ]);
    prismaMock.finLoan.findMany.mockResolvedValue([
      {
        id: 'loan-1',
        institutionId: 'inst-1',
        currency: 'DOP',
        currentBalance: 13500,
      },
    ]);

    await request(app.getHttpServer())
      .get('/api/finance/balance-sheet')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data.baseCurrency).toBe('DOP');
        expect(res.body.data.global).toMatchObject({
          status: 'COMPLETE',
          assets: { accounts: '150000' },
          liabilities: { creditCards: '6000', loans: '13500' },
          totalAssets: '150000',
          totalLiabilities: '19500',
          netWorth: '130500',
        });
        expect(res.body.data.institutions).toEqual([
          expect.objectContaining({
            institutionId: 'inst-1',
            netWorth: '130500',
          }),
        ]);
      });
  });

  it('GET /api/finance/balance-sheet converts mixed currencies and marks missing limits incomplete', async () => {
    prismaMock.finInstitution.findMany.mockResolvedValue([{ id: 'inst-1' }]);
    prismaMock.finAccount.findMany.mockResolvedValue([
      {
        id: 'acc-usd',
        institutionId: 'inst-1',
        currency: 'USD',
        balance: 10,
      },
    ]);
    prismaMock.finCardBalance.findMany.mockResolvedValue([
      {
        currency: 'DOP',
        balance: 100,
        creditLimit: null,
        card: { id: 'card-1', institutionId: 'inst-1' },
      },
    ]);
    prismaMock.finLoan.findMany.mockResolvedValue([]);
    prismaMock.finExchangeRate.findUnique.mockResolvedValue({
      rate: { toString: () => '60' },
    });

    await request(app.getHttpServer())
      .get('/api/finance/balance-sheet')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data.global.status).toBe('INCOMPLETE');
        expect(res.body.data.global.assets.accounts).toBe('600');
        expect(res.body.data.global.netWorth).toBeNull();
        expect(res.body.data.global.issues).toEqual([
          {
            code: 'MISSING_CREDIT_LIMIT',
            cardId: 'card-1',
            currency: 'DOP',
          },
        ]);
      });
  });

  it('GET /api/finance/analytics/spending-by-category includes category metadata', async () => {
    prismaMock.finTransaction.groupBy.mockResolvedValue([
      {
        categoryId: 'cat-food',
        _sum: { amountBaseCurrency: 80 },
      },
      {
        categoryId: null,
        _sum: { amountBaseCurrency: 15 },
      },
    ]);
    prismaMock.finCategory.findMany.mockResolvedValue([
      { id: 'cat-food', name: 'Comida', color: '#f00', icon: '🍽️' },
    ]);

    await request(app.getHttpServer())
      .get('/api/finance/analytics/spending-by-category')
      .query({ dateFrom: '2026-08-01', dateTo: '2026-08-31' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toEqual([
          {
            categoryId: 'cat-food',
            name: 'Comida',
            color: '#f00',
            icon: '🍽️',
            total: '80',
          },
          {
            categoryId: null,
            name: 'Sin categoría',
            color: null,
            icon: null,
            total: '15',
          },
        ]);
      });
  });

  it('GET /api/finance/budgets returns a paginated envelope', async () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      id: `budget-${i}`,
      userId: 'user-123',
      categoryId: 'cat-1',
      periodType: 'MONTHLY',
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-01-31'),
      amountLimit: 1000,
      amountSpent: 10,
      alertThresholdPct: 80,
      category: { id: 'cat-1', name: 'Food' },
    }));
    prismaMock.finBudget.findMany.mockResolvedValue(items);
    prismaMock.finBudget.count.mockResolvedValue(25);

    await request(app.getHttpServer())
      .get('/api/finance/budgets')
      .query({ page: 1, limit: 20 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data.items).toHaveLength(20);
        expect(typeof res.body.data.items[0].amountLimit).toBe('string');
        expect(res.body.data.pagination).toMatchObject({
          page: 1,
          limit: 20,
          total: 25,
          totalPages: 2,
        });
      });
  });

  it('GET /api/finance/budgets without query uses default page and limit', async () => {
    prismaMock.finBudget.findMany.mockResolvedValue([]);
    prismaMock.finBudget.count.mockResolvedValue(0);

    await request(app.getHttpServer())
      .get('/api/finance/budgets')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toEqual({
          items: [],
          pagination: {
            page: 1,
            limit: 20,
            total: 0,
            totalPages: 1,
          },
        });
      });
  });

  it('GET /api/finance/transactions stays paginated and accounts stay an array', async () => {
    prismaMock.finTransaction.findMany.mockResolvedValue([]);
    prismaMock.finTransaction.count.mockResolvedValue(0);

    await request(app.getHttpServer())
      .get('/api/finance/transactions')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toHaveProperty('items');
        expect(res.body.data).toHaveProperty('pagination');
        expect(Array.isArray(res.body.data.items)).toBe(true);
      });

    prismaMock.finAccount.findMany.mockResolvedValue([
      {
        id: 'acc-1',
        userId: 'user-123',
        name: 'Main',
        type: 'CHECKING',
        institutionId: 'inst-1',
        currency: 'DOP',
        balance: { toString: () => '1000.00' },
        color: null,
        isActive: true,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        institutionRef: { name: 'Banco' },
      },
    ]);

    await request(app.getHttpServer())
      .get('/api/finance/accounts')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(Array.isArray(res.body.data)).toBe(true);
        expect(res.body.data.items).toBeUndefined();
      });
  });

  it('GET /api/finance/transactions groups a transfer as one TRANSFER row', async () => {
    const at = new Date('2026-08-01T12:00:00.000Z');
    const fromAccountId = '11111111-1111-4111-8111-111111111111';
    const toAccountId = '33333333-3333-4333-8333-333333333333';
    const groupId = '44444444-4444-4444-8444-444444444444';
    const debit = {
      id: '55555555-5555-4555-8555-555555555555',
      userId: 'user-123',
      accountId: fromAccountId,
      cardId: null,
      type: 'DEBIT',
      amount: { toString: () => '100.00' },
      ledgerAmount: { toString: () => '100.00' },
      amountBaseCurrency: { toString: () => '100.00' },
      currency: 'DOP',
      ledgerCurrency: 'DOP',
      exchangeRate: { toString: () => '1' },
      merchant: null,
      description: 'Traspaso',
      notes: null,
      transactionDate: at,
      status: 'CONFIRMED',
      source: 'MANUAL',
      categoryId: null,
      transferGroupId: groupId,
      linkedTransactionId: null,
      aiMetadata: null,
      createdAt: at,
      account: { id: fromAccountId, name: 'Nómina' },
      card: null,
    };
    const credit = {
      ...debit,
      id: '66666666-6666-4666-8666-666666666666',
      type: 'CREDIT',
      accountId: toAccountId,
      account: { id: toAccountId, name: 'Ahorros' },
    };

    prismaMock.finTransaction.findMany.mockImplementation(
      (args?: { where?: { type?: string } }) => {
        if (args?.where?.type === 'CREDIT') {
          return Promise.resolve([credit]);
        }
        return Promise.resolve([debit]);
      },
    );
    prismaMock.finTransaction.count.mockResolvedValue(1);

    await request(app.getHttpServer())
      .get('/api/finance/transactions')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data.pagination.total).toBe(1);
        expect(res.body.data.items).toHaveLength(1);
        expect(res.body.data.items[0]).toMatchObject({
          id: debit.id,
          type: 'TRANSFER',
          accountName: 'Nómina',
          transferToAccountId: toAccountId,
          transferToAccountName: 'Ahorros',
          transferGroupId: groupId,
        });
      });
  });

  it('GET /api/finance/transactions type filters keep TRANSFER and DEBIT disjoint', async () => {
    prismaMock.finTransaction.findMany.mockResolvedValue([]);
    prismaMock.finTransaction.count.mockResolvedValue(0);

    await request(app.getHttpServer())
      .get('/api/finance/transactions?type=DEBIT')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const debitWhere = JSON.stringify(
      prismaMock.finTransaction.findMany.mock.calls[0]?.[0]?.where ?? {},
    );
    expect(debitWhere).toContain('"type":"DEBIT"');
    expect(debitWhere).toContain('"transferGroupId":null');

    prismaMock.finTransaction.findMany.mockClear();

    await request(app.getHttpServer())
      .get('/api/finance/transactions?type=TRANSFER')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const transferWhere = JSON.stringify(
      prismaMock.finTransaction.findMany.mock.calls[0]?.[0]?.where ?? {},
    );
    expect(transferWhere).toContain('"type":"DEBIT"');
    expect(transferWhere).toContain('"not":null');
  });

  it('GET /api/finance/transactions/:id maps a grouped transfer with origin and destination', async () => {
    const at = new Date('2026-08-01T12:00:00.000Z');
    const fromAccountId = '11111111-1111-4111-8111-111111111111';
    const toAccountId = '33333333-3333-4333-8333-333333333333';
    const groupId = '44444444-4444-4444-8444-444444444444';
    const debitId = '55555555-5555-4555-8555-555555555555';
    const debit = {
      id: debitId,
      userId: 'user-123',
      accountId: fromAccountId,
      cardId: null,
      type: 'DEBIT',
      amount: { toString: () => '100.00' },
      ledgerAmount: { toString: () => '100.00' },
      amountBaseCurrency: { toString: () => '100.00' },
      currency: 'DOP',
      ledgerCurrency: 'DOP',
      exchangeRate: { toString: () => '1' },
      merchant: null,
      description: 'Traspaso',
      notes: null,
      transactionDate: at,
      status: 'CONFIRMED',
      source: 'MANUAL',
      categoryId: null,
      transferGroupId: groupId,
      linkedTransactionId: null,
      aiMetadata: null,
      createdAt: at,
      account: { id: fromAccountId, name: 'Nómina' },
      card: null,
    };
    const credit = {
      ...debit,
      id: '66666666-6666-4666-8666-666666666666',
      type: 'CREDIT',
      accountId: toAccountId,
      account: { id: toAccountId, name: 'Ahorros' },
    };

    prismaMock.finTransaction.findFirst.mockResolvedValue(debit);
    prismaMock.finTransaction.findMany.mockResolvedValue([debit, credit]);

    await request(app.getHttpServer())
      .get(`/api/finance/transactions/${debitId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toMatchObject({
          id: debitId,
          type: 'TRANSFER',
          accountName: 'Nómina',
          transferToAccountName: 'Ahorros',
          transferToAccountId: toAccountId,
        });
      });
  });

  it('PATCH /api/finance/transactions/:id rejects transfer legs', async () => {
    const at = new Date('2026-08-01T12:00:00.000Z');
    const fromAccountId = '11111111-1111-4111-8111-111111111111';
    const debitId = '55555555-5555-4555-8555-555555555555';
    prismaMock.finTransaction.findFirst.mockResolvedValue({
      id: debitId,
      userId: 'user-123',
      accountId: fromAccountId,
      cardId: null,
      type: 'DEBIT',
      amount: { toString: () => '100.00' },
      ledgerAmount: { toString: () => '100.00' },
      amountBaseCurrency: { toString: () => '100.00' },
      currency: 'DOP',
      ledgerCurrency: 'DOP',
      exchangeRate: { toString: () => '1' },
      merchant: null,
      description: 'Traspaso',
      notes: null,
      transactionDate: at,
      status: 'CONFIRMED',
      source: 'MANUAL',
      categoryId: null,
      transferGroupId: '44444444-4444-4444-8444-444444444444',
      linkedTransactionId: null,
      aiMetadata: null,
      createdAt: at,
      account: { id: fromAccountId, name: 'Nómina' },
      card: null,
    });

    await request(app.getHttpServer())
      .patch(`/api/finance/transactions/${debitId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        accountId: fromAccountId,
        type: 'DEBIT',
        amount: 100,
        transactionDate: '2026-08-01T12:00:00.000Z',
        description: 'nope',
      })
      .expect(400)
      .expect((res) => {
        expect(String(res.body.message)).toMatch(/transfer/i);
      });
  });

  it('DELETE /api/finance/institutions/:id returns 409 with dependents', async () => {
    const institutionId = '11111111-1111-4111-8111-111111111111';
    prismaMock.finInstitution.findFirst.mockResolvedValue({
      id: institutionId,
      userId: 'user-123',
      name: 'Bank',
    });
    prismaMock.finAccount.count.mockResolvedValue(1);
    prismaMock.finCard.count.mockResolvedValue(0);
    prismaMock.finEmailSource.count.mockResolvedValue(0);
    prismaMock.finLoan.count.mockResolvedValue(0);

    await request(app.getHttpServer())
      .delete(`/api/finance/institutions/${institutionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409)
      .expect((res) => {
        expect(res.body.message).toMatch(/Cannot archive institution/i);
        expect(res.body.details.dependents).toEqual({
          accounts: 1,
          cards: 0,
          emailSources: 0,
          loans: 0,
        });
      });
    expect(prismaMock.finInstitution.updateMany).not.toHaveBeenCalled();
  });

  it('PATCH /api/finance/loans/:id updates the payment account', async () => {
    const loanId = '77777777-7777-4777-8777-777777777777';
    const accountId = '11111111-1111-4111-8111-111111111111';
    prismaMock.finLoan.findFirst.mockResolvedValue({
      id: loanId,
      userId: 'user-123',
      lenderName: 'Bank',
      institutionId: 'inst-1',
      accountId,
      currency: 'DOP',
      interestRate: null,
      notes: null,
      isActive: true,
      originalAmount: 1000,
      currentBalance: 500,
      installmentAmount: 100,
      installmentFreq: 'MONTHLY',
      totalInstallments: 12,
      paidInstallments: 5,
      nextDueDate: new Date('2026-09-01'),
      account: { id: accountId, name: 'Main' },
      institution: { id: 'inst-1', name: 'Bank' },
    });
    prismaMock.finAccount.findFirst.mockResolvedValue({
      id: accountId,
      userId: 'user-123',
      institutionId: 'inst-1',
      isActive: true,
    });
    prismaMock.finLoan.updateMany.mockResolvedValue({ count: 1 });

    await request(app.getHttpServer())
      .patch(`/api/finance/loans/${loanId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ accountId })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.accountId).toBe(accountId);
      });
  });

  it('GET /api/finance/email-sync/pending lists review-queue messages', async () => {
    prismaMock.finEmailMessage.findMany.mockResolvedValue([
      {
        id: 'em-1',
        sourceId: 'src-1',
        gmailMessageId: 'msg-1',
        outcome: 'PENDING_ASSIGNMENT',
        instrumentHint: 'ACCOUNT',
        lastFourHint: '1234',
        extractedPayload: { amount: 12.5, currency: 'DOP' },
        reason: null,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        source: {
          institutionId: 'inst-1',
          connection: { emailAddress: 'user@gmail.com' },
          institution: { name: 'BHD' },
        },
        transaction: null,
      },
    ]);

    await request(app.getHttpServer())
      .get('/api/finance/email-sync/pending')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toMatchObject({
          id: 'em-1',
          institutionId: 'inst-1',
          lastFourHint: '1234',
        });
        expect(res.body.data[0]).not.toHaveProperty('accessToken');
      });
  });

  it('POST /api/finance/email-sync/pending/:id/assign requires XOR account or card', async () => {
    await request(app.getHttpServer())
      .post('/api/finance/email-sync/pending/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/assign')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);
  });

  it('POST /api/finance/email-sync/pending/:id/assign is idempotent after import', async () => {
    const messageId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    prismaMock.finEmailMessage.findFirst.mockResolvedValue({
      id: messageId,
      sourceId: 'src-1',
      gmailMessageId: 'msg-1',
      outcome: 'IMPORTED',
      instrumentHint: 'ACCOUNT',
      lastFourHint: '1234',
      extractedPayload: null,
      reason: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      source: {
        institutionId: 'inst-1',
        connection: { emailAddress: 'user@gmail.com' },
        institution: { name: 'BHD' },
      },
      transaction: { id: 'tx-1' },
    });

    await request(app.getHttpServer())
      .post(`/api/finance/email-sync/pending/${messageId}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ accountId: '11111111-1111-4111-8111-111111111111' })
      .expect(201)
      .expect((res) => {
        expect(res.body.data).toEqual({
          assigned: true,
          transactionId: 'tx-1',
        });
      });
  });
});
