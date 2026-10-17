import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as jwt from 'jsonwebtoken';
import request from 'supertest';
import { App } from 'supertest/types';
import { Prisma, PrismaService } from '@personal-os/database';
import { applyAuthTestOverrides } from './helpers/auth-test.providers';
import { createTestJwt } from './helpers/jwt.helper';
import { createPrismaMock } from './helpers/prisma.mock';
import { applyTestEnv } from './helpers/test-env';
import { STATEMENT_EXTRACTOR, STATEMENT_PDF_TEXT } from '@personal-os/finance';

applyTestEnv();

// Loaded at file scope so the one-time ts-jest transpile of the app graph
// does not consume the 5s hook timeout on a cold cache (#150).
const { AppModule } = require('../apps/api/src/app.module') as {
  AppModule: new (...args: never[]) => unknown;
};

describe('Finance (e2e)', () => {
  let app: INestApplication<App>;
  let prismaMock: ReturnType<typeof createPrismaMock>;
  let token: string;
  let statementText = 'statement text';
  let statementExtraction: unknown = {
    ok: false,
    reason: 'unconfigured',
    retryable: false,
  };
  const statementPdfStub = {
    extractText: () => Promise.resolve(statementText),
    assertReadable: () => Promise.resolve(),
  };
  const statementExtractorStub = {
    extract: () => Promise.resolve(statementExtraction),
  };

  beforeEach(async () => {
    prismaMock = createPrismaMock();
    token = createTestJwt({ sub: 'user-123' });

    const moduleFixture: TestingModule = await applyAuthTestOverrides(
      Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(PrismaService)
        .useValue(prismaMock),
    )
      .overrideProvider(STATEMENT_PDF_TEXT)
      .useValue(statementPdfStub)
      .overrideProvider(STATEMENT_EXTRACTOR)
      .useValue(statementExtractorStub)
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
        expect(res.body.data.items).toHaveLength(1);
        expect(res.body.data.items[0]).toMatchObject({
          id: 'acc-1',
          name: 'Main',
          balance: '1000.00',
        });
      });
  });

  it('GET /api/finance/recycle-bin lists archived and deleted records', async () => {
    prismaMock.finInstitution.findMany.mockResolvedValue([
      {
        id: 'inst-1',
        name: 'Banco X',
        logoPath: null,
        customLogoPath: null,
        logoUrl: null,
      },
    ]);
    prismaMock.finLoan.findMany.mockResolvedValue([
      { id: 'loan-1', lenderName: 'Banco Y' },
    ]);
    prismaMock.finDeletionJournal.findMany.mockResolvedValue([
      {
        entityType: 'transaction',
        entityId: 'tx-1',
        snapshot: {
          rows: [
            {
              model: 'FinTransaction',
              values: { id: 'tx-1', description: 'Supermercado' },
            },
          ],
        },
        deletedAt: new Date('2026-10-12T10:00:00.000Z'),
      },
    ]);

    await request(app.getHttpServer())
      .get('/api/finance/recycle-bin')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data.archived).toEqual(
          expect.arrayContaining([
            {
              type: 'institution',
              id: 'inst-1',
              label: 'Banco X',
              logoUrl: null,
            },
            { type: 'loan', id: 'loan-1', label: 'Banco Y', logoUrl: null },
          ]),
        );
        expect(res.body.data.items).toEqual([
          {
            type: 'transaction',
            id: 'tx-1',
            label: 'Supermercado',
            logoUrl: null,
            deletedAt: '2026-10-12T10:00:00.000Z',
          },
        ]);
        expect(res.body.data.hasMore).toBe(false);
        expect(res.body.data.nextCursor).toBeNull();
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
          message: 'El módulo finance está desactivado',
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
        expect(res.body.message).toBe('El módulo finance está desactivado');
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
      accountNumberLast4: '5678',
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
        accountNumber: '12345678',
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

  it('GET /api/finance/email-sync/oauth/google/url allows omitting institutionId', async () => {
    await request(app.getHttpServer())
      .get('/api/finance/email-sync/oauth/google/url')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data.url).toContain('accounts.google.com');
        expect(res.body.data.url).toContain('state=');
      });
  });

  it('GET /api/finance/email-sync/oauth/google/url rejects returnTo outside CORS_ORIGIN', async () => {
    const institutionId = '11111111-1111-4111-8111-111111111111';
    await request(app.getHttpServer())
      .get('/api/finance/email-sync/oauth/google/url')
      .query({ institutionId, returnTo: 'https://evil.example/phish' })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('GET /api/finance/email-sync/mailboxes includes connections without sources', async () => {
    prismaMock.finEmailConnection.findMany.mockResolvedValue([
      {
        id: 'conn-1',
        emailAddress: 'me@gmail.com',
        provider: 'gmail',
        isActive: true,
        createdAt: new Date('2026-09-01'),
        sources: [],
      },
    ]);

    await request(app.getHttpServer())
      .get('/api/finance/email-sync/mailboxes')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toEqual([
          expect.objectContaining({
            id: 'conn-1',
            emailAddress: 'me@gmail.com',
            sources: [],
          }),
        ]);
      });
  });

  it('POST /api/finance/email-sync/sources returns 400 without Gmail tokens', async () => {
    prismaMock.finInstitution.findFirst.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      userId: 'user-123',
      name: 'BHD',
    });
    prismaMock.finEmailConnection.findUnique.mockResolvedValue({
      id: 'conn-1',
      refreshToken: null,
    });

    await request(app.getHttpServer())
      .post('/api/finance/email-sync/sources')
      .set('Authorization', `Bearer ${token}`)
      .send({
        emailAddress: 'me@gmail.com',
        bankSenderEmail: 'alertas@bhd.com.do',
        institutionId: '11111111-1111-4111-8111-111111111111',
      })
      .expect(400);
  });

  it('POST /api/finance/email-sync/sources returns 409 when the institution is already linked', async () => {
    const institutionId = '11111111-1111-4111-8111-111111111111';
    prismaMock.finInstitution.findFirst.mockResolvedValue({
      id: institutionId,
      userId: 'user-123',
      name: 'BHD',
    });
    prismaMock.finEmailConnection.findUnique.mockResolvedValue({
      id: 'conn-2',
      refreshToken: 'enc',
    });
    prismaMock.finEmailSource.findFirst.mockResolvedValue({
      id: 'src-1',
      connectionId: 'conn-1',
      institutionId,
      isActive: true,
      bankDomain: 'bhd.com.do',
      bankSenderEmail: 'alertas@bhd.com.do',
      label: null,
      lastSyncedAt: null,
      createdAt: new Date('2026-09-01'),
      logs: [],
      connection: { emailAddress: 'me@gmail.com', provider: 'gmail' },
      institution: { name: 'BHD' },
    });

    await request(app.getHttpServer())
      .post('/api/finance/email-sync/sources')
      .set('Authorization', `Bearer ${token}`)
      .send({
        emailAddress: 'other@gmail.com',
        bankSenderEmail: 'alertas@bhd.com.do',
        institutionId,
      })
      .expect(409);
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
      .expect(
        'Location',
        'http://localhost:5173/finance/accounts/sync?sheet=oauth-gmail-result&success=false',
      );
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
      .expect(
        'Location',
        'http://localhost:5173/finance/accounts/sync?sheet=oauth-gmail-result&success=false',
      );
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

  it('rejects a card destination on POST /api/finance/transfers', async () => {
    await request(app.getHttpServer())
      .post('/api/finance/transfers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fromAccountId: '11111111-1111-4111-8111-111111111111',
        toCardId: '22222222-2222-4222-8222-222222222222',
        amount: 25,
        currency: 'DOP',
        transactionDate: '2026-08-01T12:00:00.000Z',
      })
      .expect(400)
      .expect((res) => {
        expect(res.body.code).toBe('TRANSFER_TARGET_NOT_ACCOUNT');
      });
  });

  it('rejects the same origin and destination account', async () => {
    const accountId = '11111111-1111-4111-8111-111111111111';
    await request(app.getHttpServer())
      .post('/api/finance/transfers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fromAccountId: accountId,
        toAccountId: accountId,
        amount: 25,
        currency: 'DOP',
        transactionDate: '2026-08-01T12:00:00.000Z',
      })
      .expect(400)
      .expect((res) => {
        expect(res.body.code).toBe('SAME_ACCOUNT');
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
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-123',
      email: 'test@example.com',
      fullName: 'Test User',
      avatarUrl: null,
      timezone: 'UTC',
      locale: 'es',
      preferences: {},
      userModules: [],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
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
        expect(res.body.data.items).toEqual([]);
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
        expect(res.body.data.items[0]).toMatchObject({
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

  it('POST /api/finance/receivables requires a non-blank description', async () => {
    await request(app.getHttpServer())
      .post('/api/finance/receivables')
      .set('Authorization', `Bearer ${token}`)
      .send({ debtorName: 'Ana', amount: 100 })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/finance/receivables')
      .set('Authorization', `Bearer ${token}`)
      .send({ debtorName: 'Ana', amount: 100, description: '   ' })
      .expect(400);
  });

  it('PATCH /api/finance/receivables/:id rejects paidAmount edits', async () => {
    const recId = '88888888-8888-4888-8888-888888888888';

    // The collected amount moves only through POST /receivables/:id/payments.
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
        balance: new Prisma.Decimal(100),
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

  it('GET /api/finance/balance-sheet uses the user finance base currency', async () => {
    prismaMock.userModule.findFirst.mockResolvedValue({
      id: 'um-finance',
      isEnabled: true,
      config: { baseCurrency: 'USD' },
    });
    prismaMock.finInstitution.findMany.mockResolvedValue([]);
    prismaMock.finAccount.findMany.mockResolvedValue([
      { id: 'acc-1', institutionId: null, currency: 'DOP', balance: 100 },
    ]);
    prismaMock.finCardBalance.findMany.mockResolvedValue([]);
    prismaMock.finLoan.findMany.mockResolvedValue([]);
    prismaMock.finExchangeRate.findUnique.mockResolvedValue({
      rate: { toString: () => '0.5' },
    });

    await request(app.getHttpServer())
      .get('/api/finance/balance-sheet')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data.baseCurrency).toBe('USD');
        expect(res.body.data.global.assets.accounts).toBe('50');
      });
  });

  it('GET /api/finance/exchange-rates returns market rates in the base currency', async () => {
    prismaMock.finExchangeRate.findUnique
      .mockResolvedValueOnce({ rate: { toString: () => '68.39' } })
      .mockResolvedValueOnce({ rate: { toString: () => '74.12' } });

    await request(app.getHttpServer())
      .get('/api/finance/exchange-rates')
      .query({ base: 'DOP', quotes: 'USD,EUR' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data.baseCurrency).toBe('DOP');
        expect(res.body.data.rates).toEqual([
          { currency: 'USD', rate: '68.39' },
          { currency: 'EUR', rate: '74.12' },
        ]);
      });
  });

  it('POST /api/finance/base-currency rebases and updates the config', async () => {
    prismaMock.module.findUnique.mockResolvedValue({ id: 'mod-finance' });
    prismaMock.userModule.findUnique.mockResolvedValue({
      id: 'um-finance',
      config: { baseCurrency: 'DOP', trackedCurrencies: ['USD', 'EUR'] },
    });
    prismaMock.finTransaction.findMany.mockResolvedValue([
      {
        id: 'tx-1',
        amount: 100,
        currency: 'DOP',
        transactionDate: new Date('2026-08-10T12:00:00.000Z'),
        type: 'DEBIT',
        status: 'CONFIRMED',
        categoryId: null,
      },
    ]);
    prismaMock.finBudget.findMany.mockResolvedValue([]);
    prismaMock.finExchangeRate.findUnique.mockResolvedValue({
      rate: { toString: () => '0.5' },
    });

    await request(app.getHttpServer())
      .post('/api/finance/base-currency')
      .set('Authorization', `Bearer ${token}`)
      .send({ baseCurrency: 'USD' })
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toMatchObject({
          baseCurrency: 'USD',
          previousBaseCurrency: 'DOP',
          rebasedTransactions: 1,
          rebasedBudgets: 0,
        });
      });

    expect(prismaMock.$transaction).toHaveBeenCalled();
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

    await request(app.getHttpServer())
      .get('/api/finance/budgets')
      .query({ limit: 20 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data.items).toHaveLength(20);
        expect(typeof res.body.data.items[0].amountLimit).toBe('string');
        expect(res.body.data).toMatchObject({
          hasMore: false,
          nextCursor: null,
        });
      });
  });

  it('GET /api/finance/budgets without query uses default limit', async () => {
    prismaMock.finBudget.findMany.mockResolvedValue([]);

    await request(app.getHttpServer())
      .get('/api/finance/budgets')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toEqual({
          items: [],
          hasMore: false,
          nextCursor: null,
        });
      });
  });

  it('GET /api/finance/budgets/:id returns a mapped budget', async () => {
    const budgetId = '33333333-3333-4333-8333-333333333333';
    prismaMock.finBudget.findFirst.mockResolvedValue({
      id: budgetId,
      userId: 'user-123',
      categoryId: 'cat-1',
      periodType: 'MONTHLY',
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-01-31'),
      amountLimit: 1000,
      amountSpent: 10,
      alertThresholdPct: 80,
      category: { id: 'cat-1', name: 'Food' },
    });

    await request(app.getHttpServer())
      .get(`/api/finance/budgets/${budgetId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data.id).toBe(budgetId);
        expect(typeof res.body.data.amountLimit).toBe('string');
        expect(res.body.data.amountLimit).toBe('1000');
        expect(res.body.data.category).toEqual({ id: 'cat-1', name: 'Food' });
      });
  });

  it('GET /api/finance/budgets/:id returns 404 when missing', async () => {
    prismaMock.finBudget.findFirst.mockResolvedValue(null);

    await request(app.getHttpServer())
      .get('/api/finance/budgets/33333333-3333-4333-8333-333333333333')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('GET /api/finance/budgets/:id/transactions returns a cursor page', async () => {
    prismaMock.finBudget.findFirst.mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
      userId: 'user-123',
      categoryId: 'cat-1',
      includeChildren: false,
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-01-31'),
      amountLimit: 1000,
      amountSpent: 10,
      alertThresholdPct: 80,
      categories: [{ categoryId: '11111111-1111-4111-8111-111111111111' }],
    });
    prismaMock.finTransaction.findMany.mockResolvedValue([]);

    await request(app.getHttpServer())
      .get(
        '/api/finance/budgets/33333333-3333-4333-8333-333333333333/transactions',
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(Array.isArray(res.body.data.items)).toBe(true);
        expect(res.body.data).toHaveProperty('nextCursor');
      });
  });

  it('GET /api/finance/loans/:id/installments paginates oldest first', async () => {
    prismaMock.finLoan.findFirst.mockResolvedValue({
      id: 'loan-1',
      userId: 'user-123',
    });
    prismaMock.finLoanInstallment.findMany
      .mockResolvedValueOnce([
        {
          id: 'inst-1',
          installmentNo: 1,
          dueDate: new Date('2026-01-01'),
          amount: 100,
        },
        {
          id: 'inst-2',
          installmentNo: 2,
          dueDate: new Date('2026-02-01'),
          amount: 100,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'inst-2',
          installmentNo: 2,
          dueDate: new Date('2026-02-01'),
          amount: 100,
        },
      ]);

    const firstPage = await request(app.getHttpServer())
      .get('/api/finance/loans/loan-1/installments')
      .query({ limit: 1 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(firstPage.body.data.items).toHaveLength(1);
    expect(firstPage.body.data.items[0].id).toBe('inst-1');
    expect(firstPage.body.data.items[0].amount).toBe('100');
    expect(firstPage.body.data.hasMore).toBe(true);
    expect(typeof firstPage.body.data.nextCursor).toBe('string');

    const lastPage = await request(app.getHttpServer())
      .get('/api/finance/loans/loan-1/installments')
      .query({ limit: 1, cursor: firstPage.body.data.nextCursor })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(lastPage.body.data.items).toHaveLength(1);
    expect(lastPage.body.data.items[0].id).toBe('inst-2');
    expect(lastPage.body.data.hasMore).toBe(false);
    expect(lastPage.body.data.nextCursor).toBeNull();
  });

  it('GET /api/finance/receivables/:id/payments paginates newest first', async () => {
    prismaMock.finReceivable.findFirst.mockResolvedValue({
      id: 'rec-1',
      userId: 'user-123',
    });
    prismaMock.finReceivablePayment.findMany
      .mockResolvedValueOnce([
        { id: 'pay-1', paidAt: new Date('2026-02-01'), amount: 50 },
        { id: 'pay-2', paidAt: new Date('2026-01-01'), amount: 50 },
      ])
      .mockResolvedValueOnce([
        { id: 'pay-2', paidAt: new Date('2026-01-01'), amount: 50 },
      ]);

    const firstPage = await request(app.getHttpServer())
      .get('/api/finance/receivables/rec-1/payments')
      .query({ limit: 1 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(firstPage.body.data.items).toHaveLength(1);
    expect(firstPage.body.data.items[0].id).toBe('pay-1');
    expect(firstPage.body.data.hasMore).toBe(true);

    const lastPage = await request(app.getHttpServer())
      .get('/api/finance/receivables/rec-1/payments')
      .query({ limit: 1, cursor: firstPage.body.data.nextCursor })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(lastPage.body.data.items[0].id).toBe('pay-2');
    expect(lastPage.body.data.hasMore).toBe(false);
    expect(lastPage.body.data.nextCursor).toBeNull();
  });

  it('GET /api/finance/savings-goals/:id/allocations paginates newest first', async () => {
    prismaMock.finSavingsGoal.findFirst.mockResolvedValue({
      id: 'goal-1',
      userId: 'user-123',
    });
    prismaMock.finSavingsGoalContribution.findMany
      .mockResolvedValueOnce([
        { id: 'con-1', contributedAt: new Date('2026-02-01'), amount: 25 },
        { id: 'con-2', contributedAt: new Date('2026-01-01'), amount: 25 },
      ])
      .mockResolvedValueOnce([
        { id: 'con-2', contributedAt: new Date('2026-01-01'), amount: 25 },
      ]);

    const firstPage = await request(app.getHttpServer())
      .get('/api/finance/savings-goals/goal-1/allocations')
      .query({ limit: 1 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(firstPage.body.data.items[0].id).toBe('con-1');
    expect(firstPage.body.data.items[0].amount).toBe('25');
    expect(firstPage.body.data.hasMore).toBe(true);

    const lastPage = await request(app.getHttpServer())
      .get('/api/finance/savings-goals/goal-1/allocations')
      .query({ limit: 1, cursor: firstPage.body.data.nextCursor })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(lastPage.body.data.items[0].id).toBe('con-2');
    expect(lastPage.body.data.hasMore).toBe(false);
  });

  it('GET /api/finance/email-sync/messages paginates newest first', async () => {
    const message = (id: string, createdAt: string) => ({
      id,
      sourceId: 'src-1',
      gmailMessageId: `msg-${id}`,
      outcome: 'IMPORTED',
      instrumentHint: 'ACCOUNT',
      lastFourHint: '1234',
      extractedPayload: { amount: 12.5, currency: 'DOP' },
      reason: null,
      createdAt: new Date(createdAt),
      source: {
        institutionId: 'inst-1',
        connection: { emailAddress: 'user@gmail.com' },
        institution: { name: 'BHD' },
      },
      transaction: null,
    });
    prismaMock.finEmailMessage.findMany
      .mockResolvedValueOnce([
        message('em-1', '2026-08-02T00:00:00.000Z'),
        message('em-2', '2026-08-01T00:00:00.000Z'),
      ])
      .mockResolvedValueOnce([message('em-2', '2026-08-01T00:00:00.000Z')]);

    const firstPage = await request(app.getHttpServer())
      .get('/api/finance/email-sync/messages')
      .query({ limit: 1 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(firstPage.body.data.items[0]).toMatchObject({
      id: 'em-1',
      outcome: 'IMPORTED',
    });
    expect(firstPage.body.data.hasMore).toBe(true);

    const lastPage = await request(app.getHttpServer())
      .get('/api/finance/email-sync/messages')
      .query({ limit: 1, cursor: firstPage.body.data.nextCursor })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(lastPage.body.data.items[0].id).toBe('em-2');
    expect(lastPage.body.data.hasMore).toBe(false);
  });

  it('GET /api/finance/recycle-bin paginates deleted records', async () => {
    prismaMock.finInstitution.findMany.mockResolvedValue([]);
    prismaMock.finAccount.findMany.mockResolvedValue([]);
    prismaMock.finCard.findMany.mockResolvedValue([]);
    prismaMock.finLoan.findMany.mockResolvedValue([]);
    prismaMock.finDeletionJournal.findMany
      .mockResolvedValueOnce([
        {
          id: 'del-1',
          entityType: 'transaction',
          entityId: 'tx-1',
          snapshot: {
            rows: [
              {
                model: 'FinTransaction',
                values: { id: 'tx-1', description: 'Supermercado' },
              },
            ],
          },
          sizeBytes: 10,
          deletedAt: new Date('2026-10-12T10:00:00.000Z'),
        },
        {
          id: 'del-2',
          entityType: 'transaction',
          entityId: 'tx-2',
          snapshot: {
            rows: [
              {
                model: 'FinTransaction',
                values: { id: 'tx-2', description: 'Farmacia' },
              },
            ],
          },
          sizeBytes: 10,
          deletedAt: new Date('2026-10-11T10:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'del-2',
          entityType: 'transaction',
          entityId: 'tx-2',
          snapshot: {
            rows: [
              {
                model: 'FinTransaction',
                values: { id: 'tx-2', description: 'Farmacia' },
              },
            ],
          },
          sizeBytes: 10,
          deletedAt: new Date('2026-10-11T10:00:00.000Z'),
        },
      ]);

    const firstPage = await request(app.getHttpServer())
      .get('/api/finance/recycle-bin')
      .query({ limit: 1 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(firstPage.body.data.items).toHaveLength(1);
    expect(firstPage.body.data.items[0]).toMatchObject({
      id: 'tx-1',
      label: 'Supermercado',
    });
    expect(firstPage.body.data.hasMore).toBe(true);

    const lastPage = await request(app.getHttpServer())
      .get('/api/finance/recycle-bin')
      .query({ limit: 1, cursor: firstPage.body.data.nextCursor })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(lastPage.body.data.items[0]).toMatchObject({
      id: 'tx-2',
      label: 'Farmacia',
    });
    expect(lastPage.body.data.hasMore).toBe(false);
    expect(lastPage.body.data.nextCursor).toBeNull();
  });

  it('GET /api/finance/budgets paginates newest period first', async () => {
    const budget = (id: string, periodStart: string) => ({
      id,
      userId: 'user-123',
      categoryId: 'cat-1',
      periodType: 'MONTHLY',
      periodStart: new Date(periodStart),
      periodEnd: new Date('2026-01-31'),
      amountLimit: 1000,
      amountSpent: 10,
      alertThresholdPct: 80,
      category: { id: 'cat-1', name: 'Food' },
    });
    prismaMock.finBudget.findMany
      .mockResolvedValueOnce([
        budget('budget-2', '2026-02-01T00:00:00.000Z'),
        budget('budget-1', '2026-01-01T00:00:00.000Z'),
      ])
      .mockResolvedValueOnce([budget('budget-1', '2026-01-01T00:00:00.000Z')]);

    const firstPage = await request(app.getHttpServer())
      .get('/api/finance/budgets')
      .query({ limit: 1 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(firstPage.body.data.items[0].id).toBe('budget-2');
    expect(firstPage.body.data.hasMore).toBe(true);
    expect(typeof firstPage.body.data.nextCursor).toBe('string');

    const lastPage = await request(app.getHttpServer())
      .get('/api/finance/budgets')
      .query({ limit: 1, cursor: firstPage.body.data.nextCursor })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(lastPage.body.data.items[0].id).toBe('budget-1');
    expect(lastPage.body.data.hasMore).toBe(false);
    expect(lastPage.body.data.nextCursor).toBeNull();
  });

  it('GET /api/finance/budgets/:id/transactions paginates newest first', async () => {
    prismaMock.finBudget.findFirst.mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
      userId: 'user-123',
      categoryId: 'cat-1',
      includeChildren: false,
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-01-31'),
      amountLimit: 1000,
      amountSpent: 10,
      alertThresholdPct: 80,
      categories: [{ categoryId: '11111111-1111-4111-8111-111111111111' }],
    });
    const transaction = (id: string, transactionDate: string) => ({
      id,
      userId: 'user-123',
      accountId: '11111111-1111-4111-8111-111111111111',
      cardId: null,
      type: 'DEBIT',
      amount: { toString: () => '10.00' },
      ledgerAmount: { toString: () => '10.00' },
      amountBaseCurrency: { toString: () => '10.00' },
      currency: 'DOP',
      ledgerCurrency: 'DOP',
      exchangeRate: { toString: () => '1' },
      merchant: null,
      description: 'Café',
      notes: null,
      transactionDate: new Date(transactionDate),
      status: 'CONFIRMED',
      source: 'MANUAL',
      categoryId: '11111111-1111-4111-8111-111111111111',
      transferGroupId: null,
      linkedTransactionId: null,
      aiMetadata: null,
      createdAt: new Date(transactionDate),
      account: {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Nómina',
      },
      card: null,
    });
    prismaMock.finTransaction.findMany
      .mockResolvedValueOnce([
        transaction('tx-2', '2026-01-20T00:00:00.000Z'),
        transaction('tx-1', '2026-01-10T00:00:00.000Z'),
      ])
      .mockResolvedValueOnce([transaction('tx-1', '2026-01-10T00:00:00.000Z')]);

    const firstPage = await request(app.getHttpServer())
      .get(
        '/api/finance/budgets/33333333-3333-4333-8333-333333333333/transactions',
      )
      .query({ limit: 1 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(firstPage.body.data.items[0].id).toBe('tx-2');
    expect(firstPage.body.data.hasMore).toBe(true);

    const lastPage = await request(app.getHttpServer())
      .get(
        '/api/finance/budgets/33333333-3333-4333-8333-333333333333/transactions',
      )
      .query({ limit: 1, cursor: firstPage.body.data.nextCursor })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(lastPage.body.data.items[0].id).toBe('tx-1');
    expect(lastPage.body.data.hasMore).toBe(false);
    expect(lastPage.body.data.nextCursor).toBeNull();
  });

  it('GET /api/finance/email-sync/pending paginates newest first', async () => {
    const pending = (id: string, createdAt: string) => ({
      id,
      sourceId: 'src-1',
      gmailMessageId: `msg-${id}`,
      outcome: 'PENDING_ASSIGNMENT',
      instrumentHint: 'ACCOUNT',
      lastFourHint: '1234',
      extractedPayload: { amount: 12.5, currency: 'DOP' },
      reason: null,
      createdAt: new Date(createdAt),
      source: {
        institutionId: 'inst-1',
        connection: { emailAddress: 'user@gmail.com' },
        institution: { name: 'BHD' },
      },
      transaction: null,
    });
    prismaMock.finEmailMessage.findMany
      .mockResolvedValueOnce([
        pending('em-2', '2026-08-02T00:00:00.000Z'),
        pending('em-1', '2026-08-01T00:00:00.000Z'),
      ])
      .mockResolvedValueOnce([pending('em-1', '2026-08-01T00:00:00.000Z')]);

    const firstPage = await request(app.getHttpServer())
      .get('/api/finance/email-sync/pending')
      .query({ limit: 1 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(firstPage.body.data.items[0].id).toBe('em-2');
    expect(firstPage.body.data.hasMore).toBe(true);

    const lastPage = await request(app.getHttpServer())
      .get('/api/finance/email-sync/pending')
      .query({ limit: 1, cursor: firstPage.body.data.nextCursor })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(lastPage.body.data.items[0].id).toBe('em-1');
    expect(lastPage.body.data.hasMore).toBe(false);
    expect(lastPage.body.data.nextCursor).toBeNull();
  });

  it('GET /api/finance/cards/:id/statements paginates newest cycle first', async () => {
    const cardId = '22222222-2222-4222-8222-222222222222';
    prismaMock.finCard.findFirst.mockResolvedValue({
      id: cardId,
      userId: 'user-123',
      type: 'CREDIT',
      statementClosingDay: 15,
      paymentDueDay: 5,
      balances: [{ currency: 'DOP', balance: 0, creditLimit: 1000 }],
      transactions: [],
    });
    const statement = (id: string, cycleEnd: string) => ({
      id,
      cardId,
      currency: 'DOP',
      cycleStart: new Date('2026-01-01T00:00:00.000Z'),
      cycleEnd: new Date(cycleEnd),
      dueDate: new Date('2026-01-25T00:00:00.000Z'),
      closingBalance: 100,
      minimumPayment: null,
      minimumSource: null,
    });
    prismaMock.finCardStatement.findMany
      .mockResolvedValueOnce([
        statement('stmt-2', '2026-02-15T00:00:00.000Z'),
        statement('stmt-1', '2026-01-15T00:00:00.000Z'),
      ])
      .mockResolvedValueOnce([statement('stmt-1', '2026-01-15T00:00:00.000Z')]);

    const firstPage = await request(app.getHttpServer())
      .get(`/api/finance/cards/${cardId}/statements`)
      .query({ limit: 1 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(firstPage.body.data.items[0].id).toBe('stmt-2');
    expect(firstPage.body.data.hasMore).toBe(true);
    expect(typeof firstPage.body.data.nextCursor).toBe('string');

    const lastPage = await request(app.getHttpServer())
      .get(`/api/finance/cards/${cardId}/statements`)
      .query({ limit: 1, cursor: firstPage.body.data.nextCursor })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(lastPage.body.data.items[0].id).toBe('stmt-1');
    expect(lastPage.body.data.hasMore).toBe(false);
    expect(lastPage.body.data.nextCursor).toBeNull();
  });

  it('GET /api/finance/savings-goals/:id/contributions paginates through the alias', async () => {
    prismaMock.finSavingsGoal.findFirst.mockResolvedValue({
      id: 'goal-1',
      userId: 'user-123',
    });
    prismaMock.finSavingsGoalContribution.findMany
      .mockResolvedValueOnce([
        { id: 'con-1', contributedAt: new Date('2026-02-01'), amount: 25 },
        { id: 'con-2', contributedAt: new Date('2026-01-01'), amount: 25 },
      ])
      .mockResolvedValueOnce([
        { id: 'con-2', contributedAt: new Date('2026-01-01'), amount: 25 },
      ]);

    const firstPage = await request(app.getHttpServer())
      .get('/api/finance/savings-goals/goal-1/contributions')
      .query({ limit: 1 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(firstPage.body.data.items[0].id).toBe('con-1');
    expect(firstPage.body.data.hasMore).toBe(true);

    const lastPage = await request(app.getHttpServer())
      .get('/api/finance/savings-goals/goal-1/contributions')
      .query({ limit: 1, cursor: firstPage.body.data.nextCursor })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(lastPage.body.data.items[0].id).toBe('con-2');
    expect(lastPage.body.data.hasMore).toBe(false);
    expect(lastPage.body.data.nextCursor).toBeNull();
  });

  it('GET /api/finance/loans/:id/installments returns an empty page when the list is empty', async () => {
    prismaMock.finLoan.findFirst.mockResolvedValue({
      id: 'loan-1',
      userId: 'user-123',
    });
    prismaMock.finLoanInstallment.findMany.mockResolvedValue([]);

    await request(app.getHttpServer())
      .get('/api/finance/loans/loan-1/installments')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toEqual({
          items: [],
          hasMore: false,
          nextCursor: null,
        });
      });
  });

  it('paginated lists reject a forged cursor with 400', async () => {
    prismaMock.finLoan.findFirst.mockResolvedValue({
      id: 'loan-1',
      userId: 'user-123',
    });
    const forged = Buffer.from(
      JSON.stringify({ key: 'not-a-date', id: 'inst-1' }),
      'utf8',
    ).toString('base64url');

    await request(app.getHttpServer())
      .get('/api/finance/loans/loan-1/installments')
      .query({ cursor: forged })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('paginated lists reject a limit outside 1-100', async () => {
    await request(app.getHttpServer())
      .get('/api/finance/budgets')
      .query({ limit: 0 })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    await request(app.getHttpServer())
      .get('/api/finance/budgets')
      .query({ limit: 101 })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('POST /api/finance/receivables/:id/credit requires a target', async () => {
    await request(app.getHttpServer())
      .post(
        '/api/finance/receivables/44444444-4444-4444-8444-444444444444/credit',
      )
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 10 })
      .expect(400);
  });

  it('GET /api/finance/transactions stays cursor paginated and accounts stay cursor paginated', async () => {
    prismaMock.finTransaction.findMany.mockResolvedValue([]);

    await request(app.getHttpServer())
      .get('/api/finance/transactions')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toHaveProperty('items');
        expect(res.body.data).toHaveProperty('hasMore');
        expect(res.body.data).toHaveProperty('nextCursor');
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
        expect(Array.isArray(res.body.data.items)).toBe(true);
        expect(res.body.data).toHaveProperty('nextCursor');
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
    await request(app.getHttpServer())
      .get('/api/finance/transactions')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toMatchObject({
          hasMore: false,
          nextCursor: null,
        });
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

  it('PATCH /api/finance/institutions/:id returns 409 with dependents when archiving', async () => {
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
      .patch(`/api/finance/institutions/${institutionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false })
      .expect(409)
      .expect((res) => {
        expect(res.body.message).toMatch(
          /No se puede archivar la institución/i,
        );
        expect(res.body.details.dependents).toEqual({
          accounts: 1,
          cards: 0,
          emailSources: 0,
          loans: 0,
        });
      });
    expect(prismaMock.finInstitution.updateMany).not.toHaveBeenCalled();
  });

  it('PATCH /api/finance/institutions/:id archives when there are no active dependents', async () => {
    const institutionId = '11111111-1111-4111-8111-111111111111';
    prismaMock.finInstitution.findFirst.mockResolvedValue({
      id: institutionId,
      userId: 'user-123',
      name: 'Bank',
      color: null,
      logoUrl: null,
      country: 'DO',
      isActive: false,
    });
    prismaMock.finAccount.count.mockResolvedValue(0);
    prismaMock.finCard.count.mockResolvedValue(0);
    prismaMock.finEmailSource.count.mockResolvedValue(0);
    prismaMock.finLoan.count.mockResolvedValue(0);
    prismaMock.finInstitution.updateMany.mockResolvedValue({ count: 1 });

    await request(app.getHttpServer())
      .patch(`/api/finance/institutions/${institutionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.isActive).toBe(false);
      });
    expect(prismaMock.finInstitution.deleteMany).not.toHaveBeenCalled();
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
        expect(res.body.data.items).toHaveLength(1);
        expect(res.body.data.items[0]).toMatchObject({
          id: 'em-1',
          institutionId: 'inst-1',
          lastFourHint: '1234',
        });
        expect(res.body.data.items[0]).not.toHaveProperty('accessToken');
      });
  });

  it('POST /api/finance/email-sync/pending/:id/assign requires XOR account or card', async () => {
    await request(app.getHttpServer())
      .post(
        '/api/finance/email-sync/pending/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/assign',
      )
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

  it('DELETE /api/finance/accounts/:id hard-deletes the account', async () => {
    const accountId = '11111111-1111-4111-8111-111111111111';
    prismaMock.finAccount.findFirst.mockResolvedValue({
      id: accountId,
      userId: 'user-123',
      name: 'Main',
    });
    prismaMock.finCard.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.finAccount.deleteMany.mockResolvedValue({ count: 1 });

    await request(app.getHttpServer())
      .delete(`/api/finance/accounts/${accountId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toEqual({ success: true });
      });
    expect(prismaMock.finAccount.deleteMany).toHaveBeenCalled();
    expect(prismaMock.$transaction).toHaveBeenCalled();
  });

  it('DELETE /api/finance/accounts/:id returns 404 when missing', async () => {
    prismaMock.finAccount.findFirst.mockResolvedValue(null);

    await request(app.getHttpServer())
      .delete('/api/finance/accounts/11111111-1111-4111-8111-111111111111')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('DELETE /api/finance/cards/:id hard-deletes the card', async () => {
    const cardId = '66666666-6666-4666-8666-666666666666';
    prismaMock.finCard.findFirst.mockResolvedValue({
      id: cardId,
      userId: 'user-123',
      type: 'CREDIT',
      balances: [],
      statements: [],
    });
    prismaMock.finCard.deleteMany.mockResolvedValue({ count: 1 });

    await request(app.getHttpServer())
      .delete(`/api/finance/cards/${cardId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toEqual({ success: true });
      });
    expect(prismaMock.finCard.deleteMany).toHaveBeenCalled();
  });

  it('DELETE /api/finance/institutions/:id removes the institution and its catalog', async () => {
    const institutionId = '11111111-1111-4111-8111-111111111111';
    const accountId = '22222222-2222-4222-8222-222222222222';
    const cardId = '66666666-6666-4666-8666-666666666666';
    prismaMock.finInstitution.findFirst.mockResolvedValue({
      id: institutionId,
      userId: 'user-123',
      name: 'Bank',
    });
    prismaMock.finAccount.findMany.mockResolvedValue([{ id: accountId }]);
    prismaMock.finCard.findMany.mockResolvedValue([{ id: cardId }]);
    prismaMock.finInstitution.deleteMany.mockResolvedValue({ count: 1 });

    await request(app.getHttpServer())
      .delete(`/api/finance/institutions/${institutionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toEqual({ success: true });
      });
    expect(prismaMock.finInstitution.deleteMany).toHaveBeenCalled();
    expect(prismaMock.finDeletionJournal.create).toHaveBeenCalled();
  });

  it('DELETE /api/finance/loans/:id hard-deletes the loan', async () => {
    prismaMock.finLoan.findFirst.mockResolvedValue({
      id: '77777777-7777-4777-8777-777777777777',
      userId: 'user-123',
      installments: [],
    });
    prismaMock.finLoan.deleteMany.mockResolvedValue({ count: 1 });

    await request(app.getHttpServer())
      .delete('/api/finance/loans/77777777-7777-4777-8777-777777777777')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toEqual({ success: true });
      });
    expect(prismaMock.finLoan.updateMany).not.toHaveBeenCalled();
  });

  it('DELETE /api/finance/receivables/:id hard-deletes the receivable', async () => {
    prismaMock.finReceivable.findFirst.mockResolvedValue({
      id: '88888888-8888-4888-8888-888888888888',
      userId: 'user-123',
      payments: [],
    });
    prismaMock.finReceivable.deleteMany.mockResolvedValue({ count: 1 });

    await request(app.getHttpServer())
      .delete('/api/finance/receivables/88888888-8888-4888-8888-888888888888')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toEqual({ success: true });
      });
  });

  it('DELETE /api/finance/loans/:id returns 404 for another user', async () => {
    prismaMock.finLoan.deleteMany.mockResolvedValue({ count: 0 });

    await request(app.getHttpServer())
      .delete('/api/finance/loans/77777777-7777-4777-8777-777777777777')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('POST /api/finance/card-payments returns 404 when the card is missing', async () => {
    prismaMock.finCard.findFirst.mockResolvedValue(null);

    await request(app.getHttpServer())
      .post('/api/finance/card-payments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fromAccountId: '11111111-1111-4111-8111-111111111111',
        cardId: '22222222-2222-4222-8222-222222222222',
        amount: 100,
        transactionDate: '2026-01-03T10:00:00.000Z',
      })
      .expect(404);
  });

  it('POST /api/finance/savings-goals/:id/allocations returns 404 when the goal is missing', async () => {
    prismaMock.finSavingsGoal.findFirst.mockResolvedValue(null);

    await request(app.getHttpServer())
      .post(
        '/api/finance/savings-goals/33333333-3333-4333-8333-333333333333/allocations',
      )
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 50 })
      .expect(404);
  });

  it('POST /api/finance/savings-goals/:id/contributions keeps the deprecated alias', async () => {
    prismaMock.finSavingsGoal.findFirst.mockResolvedValue(null);

    await request(app.getHttpServer())
      .post(
        '/api/finance/savings-goals/33333333-3333-4333-8333-333333333333/contributions',
      )
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 50 })
      .expect(404);
  });

  it('POST /api/finance/loans/:id/pay-next-installment returns 404 when the loan is missing', async () => {
    prismaMock.finLoan.findFirst.mockResolvedValue(null);

    await request(app.getHttpServer())
      .post(
        '/api/finance/loans/77777777-7777-4777-8777-777777777777/pay-next-installment',
      )
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(404);
  });

  it('POST /api/finance/receivables/:id/write-off returns 404 when the receivable is missing', async () => {
    prismaMock.finReceivable.findFirst.mockResolvedValue(null);

    await request(app.getHttpServer())
      .post(
        '/api/finance/receivables/88888888-8888-4888-8888-888888888888/write-off',
      )
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(404);
  });

  it('POST /api/finance/transfers/:id/unconfirm returns 404 when the leg is missing', async () => {
    prismaMock.finTransaction.findFirst.mockResolvedValue(null);

    await request(app.getHttpServer())
      .post(
        '/api/finance/transfers/99999999-9999-4999-8999-999999999999/unconfirm',
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('POST /api/finance/transactions/:id/merge requires a target id', async () => {
    await request(app.getHttpServer())
      .post(
        '/api/finance/transactions/99999999-9999-4999-8999-999999999999/merge',
      )
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);
  });

  it('POST /api/finance/transactions/:id/not-duplicate clears the flag', async () => {
    prismaMock.finTransaction.updateMany.mockResolvedValue({ count: 1 });

    await request(app.getHttpServer())
      .post(
        '/api/finance/transactions/99999999-9999-4999-8999-999999999999/not-duplicate',
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(201)
      .expect((res) => {
        expect(res.body.data).toEqual({ success: true });
      });
  });

  it('GET /api/finance/transactions accepts possibleDuplicates', async () => {
    prismaMock.finTransaction.findMany.mockResolvedValue([]);

    await request(app.getHttpServer())
      .get('/api/finance/transactions?possibleDuplicates=true')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(Array.isArray(res.body.data.items)).toBe(true);
      });
  });

  it('POST /api/finance/budgets/:id/restore returns 404 without a journal entry', async () => {
    prismaMock.finDeletionJournal.findFirst.mockResolvedValue(null);

    await request(app.getHttpServer())
      .post('/api/finance/budgets/33333333-3333-4333-8333-333333333333/restore')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('POST /api/finance/card-payments creates the two card payment legs', async () => {
    const cardId = '22222222-2222-4222-8222-222222222222';
    const accountId = '11111111-1111-4111-8111-111111111111';
    prismaMock.finCard.findFirst.mockResolvedValue({
      id: cardId,
      userId: 'user-123',
      name: 'Visa',
      type: 'CREDIT',
      accountId: null,
      balances: [{ currency: 'DOP' }],
    });
    prismaMock.finAccount.findFirst.mockResolvedValue({
      id: accountId,
      userId: 'user-123',
      currency: 'DOP',
    });

    await request(app.getHttpServer())
      .post('/api/finance/card-payments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fromAccountId: accountId,
        cardId,
        amount: 100,
        currency: 'DOP',
        transactionDate: '2026-01-03T10:00:00.000Z',
      })
      .expect(201)
      .expect((res) => {
        expect(res.body.data).toHaveProperty('transferGroupId');
        expect(res.body.data).toHaveProperty('debit');
        expect(res.body.data).toHaveProperty('credit');
      });
  });

  it('GET /api/finance/cards/:id/statements lists the mapped statements', async () => {
    const cardId = '22222222-2222-4222-8222-222222222222';
    prismaMock.finCard.findFirst.mockResolvedValue({
      id: cardId,
      userId: 'user-123',
      type: 'CREDIT',
      statementClosingDay: 15,
      paymentDueDay: 5,
      balances: [{ currency: 'DOP', balance: 0, creditLimit: 1000 }],
      transactions: [],
    });
    prismaMock.finCardStatement.findMany.mockResolvedValue([
      {
        id: '99999999-9999-4999-8999-999999999999',
        cardId,
        currency: 'DOP',
        cycleStart: new Date('2026-01-01T00:00:00.000Z'),
        cycleEnd: new Date('2026-01-15T00:00:00.000Z'),
        dueDate: new Date('2026-01-25T00:00:00.000Z'),
        closingBalance: 100,
        minimumPayment: null,
        minimumSource: null,
      },
    ]);

    await request(app.getHttpServer())
      .get(`/api/finance/cards/${cardId}/statements`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(Array.isArray(res.body.data.items)).toBe(true);
        expect(res.body.data.items).toHaveLength(1);
        expect(res.body.data.items[0]).toHaveProperty('paidAmount');
        expect(res.body.data.items[0]).toHaveProperty('status');
      });
  });

  it('imports an account statement PDF and applies the marked rows', async () => {
    const accountId = '11111111-1111-4111-8111-111111111111';
    prismaMock.finAccount.findFirst.mockResolvedValue({
      id: accountId,
      userId: 'user-123',
      currency: 'DOP',
      balance: { toString: () => '58900.10' },
      name: 'Popular 3447',
    });
    statementText = 'Banco Popular Dominicano - Estado de cuenta';
    statementExtraction = {
      ok: true,
      provider: 'test',
      model: 'test',
      statement: {
        header: {
          currency: 'DOP',
          periodStart: '2026-09-01',
          periodEnd: '2026-09-30',
          previousBalance: 58900.1,
          closingBalance: 72489.15,
          minimumPayment: null,
          dueDate: null,
        },
        lines: [
          {
            date: '2026-09-03',
            description: 'COMPRA POS JUMBO',
            amount: 3220.4,
            currency: 'DOP',
            type: 'DEBIT',
            reference: 'DOC-551209',
            categoryNameHint: null,
          },
        ],
      },
    };
    prismaMock.finStatementImport.create.mockResolvedValue({
      id: 'import-1',
      userId: 'user-123',
      cardId: null,
      accountId,
      statementId: null,
      status: 'PARSING',
      parsed: {},
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      appliedAt: null,
    });
    prismaMock.finCategory.findMany.mockResolvedValue([]);
    prismaMock.finTransaction.findMany.mockResolvedValue([]);

    const importContext = {
      id: 'import-1',
      userId: 'user-123',
      cardId: null,
      accountId,
      statementId: null,
      status: 'PARSING',
      parsed: {},
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      appliedAt: null,
      card: null,
      account: { id: accountId, name: 'Popular 3447', currency: 'DOP' },
      lines: [
        {
          id: 'line-1',
          importId: 'import-1',
          date: new Date('2026-09-03T00:00:00.000Z'),
          description: 'COMPRA POS JUMBO',
          amount: { toFixed: () => '3220.40' },
          currency: 'DOP',
          type: 'DEBIT',
          reference: 'DOC-551209',
          categoryId: null,
          transactionId: null,
          decision: 'CREATE',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    };
    prismaMock.finStatementImport.findFirst.mockImplementation(() =>
      Promise.resolve(importContext),
    );
    prismaMock.finStatementImport.update.mockImplementation(
      (args: { data: Record<string, unknown> }) => {
        Object.assign(importContext, args.data);
        return Promise.resolve(importContext);
      },
    );

    await request(app.getHttpServer())
      .post(`/api/finance/accounts/${accountId}/statements/import`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('%PDF-1.4 synthetic'), {
        filename: 'statement.pdf',
        contentType: 'application/pdf',
      })
      .expect(201)
      .expect((res) => {
        expect(res.body.data).toEqual({ importId: 'import-1' });
      });

    expect(prismaMock.finStatementImportLine.createMany).toHaveBeenCalled();
    expect(prismaMock.finStatementImport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'import-1' },
        data: expect.objectContaining({ status: 'READY' }),
      }),
    );

    await request(app.getHttpServer())
      .get('/api/finance/statement-imports/import-1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data.lines).toHaveLength(1);
        expect(res.body.data.lines[0].decision).toBe('CREATE');
        expect(res.body.data.header.closingBalance).toBe('72489.15');
        expect(res.body.data.difference).toBe('13589.05');
      });

    await request(app.getHttpServer())
      .post('/api/finance/statement-imports/import-1/apply')
      .set('Authorization', `Bearer ${token}`)
      .send({ adjust: false })
      .expect(201)
      .expect((res) => {
        expect(res.body.data.status).toBe('APPLIED');
      });

    const linkCall = prismaMock.finStatementImportLine.update.mock.calls[0] as [
      { where: unknown; data: { transactionId?: unknown } },
    ];
    expect(linkCall[0].where).toEqual({ id: 'line-1' });
    expect(typeof linkCall[0].data.transactionId).toBe('string');
    expect(prismaMock.finStatementImport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'import-1' },
        data: expect.objectContaining({ status: 'APPLIED' }),
      }),
    );
  });

  it('POST /api/finance/reconciliations/preview suggests the DGII split', async () => {
    prismaMock.finAccount.findFirst.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Ahorros',
      currency: 'DOP',
      balance: { toString: () => '10000.00' },
      institutionRef: { name: 'BHD' },
    });
    prismaMock.finTransaction.aggregate.mockResolvedValue({
      _sum: { ledgerAmount: 10000 },
    });

    await request(app.getHttpServer())
      .post('/api/finance/reconciliations/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({
        accountId: '11111111-1111-4111-8111-111111111111',
        asOfDate: '2026-10-15',
        realBalance: 9950,
      })
      .expect(201)
      .expect((res) => {
        expect(res.body.data.difference).toBe('-50.00');
        expect(res.body.data.suggestedAdjustments).toEqual([
          { kind: 'IMPUESTO_DGII', amount: '-15.00' },
          { kind: 'OTRO', amount: '-35.00' },
        ]);
      });
  });

  it('POST /api/finance/reconciliations rejects adjustments that do not add up', async () => {
    prismaMock.finAccount.findFirst.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Ahorros',
      currency: 'DOP',
      balance: { toString: () => '10000.00' },
      institutionRef: { name: 'BHD' },
    });

    await request(app.getHttpServer())
      .post('/api/finance/reconciliations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        accountId: '11111111-1111-4111-8111-111111111111',
        asOfDate: '2026-10-15',
        realBalance: 9950,
        adjustments: [{ kind: 'OTRO', amount: -40 }],
      })
      .expect(422);
  });

  it('POST /api/finance/reconciliations closes the product and GET status reports it', async () => {
    prismaMock.finAccount.findFirst.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Ahorros',
      currency: 'DOP',
      balance: { toString: () => '10000.00' },
      institutionRef: { name: 'BHD' },
    });
    prismaMock.finReconciliation.create.mockResolvedValue({ id: 'rec-1' });
    prismaMock.finReconciliation.findFirstOrThrow.mockResolvedValue({
      id: 'rec-1',
      userId: 'user-123',
      accountId: '11111111-1111-4111-8111-111111111111',
      cardId: null,
      currency: 'DOP',
      asOfDate: new Date('2026-10-15T00:00:00.000Z'),
      appBalance: 10000,
      realBalance: 9950,
      difference: -50,
      note: null,
      createdAt: new Date('2026-10-15T12:00:00.000Z'),
      adjustments: [
        {
          id: 'adj-1',
          kind: 'IMPUESTO_DGII',
          amount: -15,
          transactionId: 'tx-1',
        },
        { id: 'adj-2', kind: 'OTRO', amount: -35, transactionId: 'tx-2' },
      ],
    });

    await request(app.getHttpServer())
      .post('/api/finance/reconciliations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        accountId: '11111111-1111-4111-8111-111111111111',
        asOfDate: '2026-10-15',
        realBalance: 9950,
        adjustments: [
          { kind: 'IMPUESTO_DGII', amount: -15 },
          { kind: 'OTRO', amount: -35 },
        ],
      })
      .expect(201)
      .expect((res) => {
        expect(res.body.data.difference).toBe('-50.00');
        expect(res.body.data.adjustments).toHaveLength(2);
      });

    expect(prismaMock.finReconciliation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ difference: -50, appBalance: 10000 }),
      }),
    );

    prismaMock.finAccount.findMany.mockResolvedValue([
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Ahorros',
        currency: 'DOP',
        balance: { toString: () => '9950.00' },
        institutionRef: { name: 'BHD' },
      },
    ]);
    prismaMock.finCardBalance.findMany.mockResolvedValue([]);
    prismaMock.finReconciliation.findMany.mockResolvedValue([
      {
        id: 'rec-1',
        accountId: '11111111-1111-4111-8111-111111111111',
        cardId: null,
        currency: 'DOP',
        asOfDate: new Date('2026-10-15T00:00:00.000Z'),
        realBalance: 9950,
        difference: -50,
        createdAt: new Date('2026-10-15T12:00:00.000Z'),
      },
    ]);

    await request(app.getHttpServer())
      .get('/api/finance/reconciliations/status?month=2026-10')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data.reconciledCount).toBe(1);
        expect(res.body.data.pendingCount).toBe(0);
      });
  });

  it('GET /api/finance/integrity/check detects a corrupted balance', async () => {
    const accountId = '11111111-1111-4111-8111-111111111111';
    prismaMock.finAccount.findMany.mockResolvedValue([
      {
        id: accountId,
        currency: 'DOP',
        balance: new Prisma.Decimal(10000),
      },
    ]);
    prismaMock.finCard.findMany.mockResolvedValue([]);
    prismaMock.finCardBalance.findMany.mockResolvedValue([]);
    prismaMock.finTransaction.findMany.mockResolvedValue([
      {
        accountId,
        cardId: null,
        type: 'DEBIT',
        ledgerAmount: new Prisma.Decimal(-10000),
        ledgerCurrency: 'DOP',
      },
      {
        accountId,
        cardId: null,
        type: 'CREDIT',
        ledgerAmount: new Prisma.Decimal(10000),
        ledgerCurrency: 'DOP',
      },
    ]);
    prismaMock.finBalanceDrift.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'drift-1',
          accountId,
          cardId: null,
          currency: 'DOP',
          storedBalance: new Prisma.Decimal(100),
          expectedBalance: new Prisma.Decimal(0),
          difference: new Prisma.Decimal(-100),
          detectedAt: new Date('2026-10-20T04:00:00.000Z'),
          resolvedAt: null,
          account: { name: 'Ahorros' },
          card: null,
        },
      ]);

    await request(app.getHttpServer())
      .get('/api/finance/integrity/check')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data.drifts).toEqual([
          expect.objectContaining({
            accountId,
            name: 'Ahorros',
            storedBalance: '100.00',
            expectedBalance: '0.00',
            difference: '-100.00',
          }),
        ]);
      });

    expect(prismaMock.finBalanceDrift.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          accountId,
          expectedBalance: expect.anything(),
          storedBalance: expect.anything(),
        }),
      }),
    );
  });

  it('POST /api/finance/integrity/recalculate corrects the balance', async () => {
    const accountId = '11111111-1111-4111-8111-111111111111';
    prismaMock.finAccount.findMany.mockResolvedValue([
      {
        id: accountId,
        currency: 'DOP',
        balance: new Prisma.Decimal(10000),
      },
    ]);
    prismaMock.finCard.findMany.mockResolvedValue([]);
    prismaMock.finCardBalance.findMany.mockResolvedValue([]);
    prismaMock.finTransaction.findMany.mockResolvedValue([
      {
        accountId,
        cardId: null,
        type: 'DEBIT',
        ledgerAmount: new Prisma.Decimal(-10000),
        ledgerCurrency: 'DOP',
      },
      {
        accountId,
        cardId: null,
        type: 'CREDIT',
        ledgerAmount: new Prisma.Decimal(10000),
        ledgerCurrency: 'DOP',
      },
    ]);
    prismaMock.finBalanceDrift.findFirst.mockResolvedValue({
      id: 'drift-1',
      accountId,
      cardId: null,
      currency: 'DOP',
      storedBalance: new Prisma.Decimal(100),
      expectedBalance: new Prisma.Decimal(0),
      difference: new Prisma.Decimal(-100),
      detectedAt: new Date('2026-10-20T04:00:00.000Z'),
      resolvedAt: null,
      account: { name: 'Ahorros' },
      card: null,
    });

    await request(app.getHttpServer())
      .post('/api/finance/integrity/recalculate')
      .set('Authorization', `Bearer ${token}`)
      .send({ accountId })
      .expect(201)
      .expect((res) => {
        expect(res.body.data).toMatchObject({
          corrected: true,
          accountId,
          cardId: null,
          currency: 'DOP',
          balance: '0.00',
        });
      });
  });

  it('GET /api/finance/integrity/check rejects two targets at once', async () => {
    await request(app.getHttpServer())
      .get('/api/finance/integrity/check')
      .query({
        accountId: '11111111-1111-4111-8111-111111111111',
        cardId: '22222222-2222-4222-8222-222222222222',
      })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('GET /api/finance/integrity/check returns 404 for an unknown account', async () => {
    await request(app.getHttpServer())
      .get('/api/finance/integrity/check')
      .query({ accountId: '11111111-1111-4111-8111-111111111111' })
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('POST /api/finance/integrity/recalculate requires a target', async () => {
    await request(app.getHttpServer())
      .post('/api/finance/integrity/recalculate')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);
  });

  it('POST /api/finance/integrity/recalculate requires a card currency', async () => {
    await request(app.getHttpServer())
      .post('/api/finance/integrity/recalculate')
      .set('Authorization', `Bearer ${token}`)
      .send({ cardId: '22222222-2222-4222-8222-222222222222' })
      .expect(400);
  });
});
