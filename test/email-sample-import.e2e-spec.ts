import {
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '@personal-os/database';
import { EmailSampleImportService } from '@personal-os/intelligence';
import { applyE2eTestOverrides } from './helpers/e2e-test.providers';
import { createTestJwt } from './helpers/jwt.helper';
import { createPrismaMock } from './helpers/prisma.mock';

const { AppModule } = require('../apps/api/src/app.module') as {
  AppModule: new (...args: never[]) => unknown;
};

const manifest = {
  dryRun: true,
  selection: {
    mode: 'IDS',
    requested: 1,
    included: 1,
    cap: 20,
  },
  summary: {
    included: 1,
    notFound: 0,
    wouldPublishSignal: 1,
    wouldCreateMovement: 1,
    reviewRequired: 0,
  },
  items: [
    {
      messageId: 'message-1',
      status: 'INCLUDED',
      fromAddress: 'notificaciones@bhd.com.do',
      fromDomain: 'bhd.com.do',
      receivedAt: '2026-11-02T12:00:00.000Z',
      provider: 'groq',
      model: 'test-model',
      classification: {
        semanticType: 'FIN_TRANSACTION',
        confidence: 0.93,
        method: 'MODEL',
        movementClass: 'PURCHASE',
        kind: 'TRANSACTION',
        amount: 125.5,
        currency: 'DOP',
        transactionDate: '2026-11-01T00:00:00.000Z',
        direction: 'DEBIT',
      },
      hints: {
        bankReference: 'BHD-1',
        merchant: 'Farmacia',
        last4: '4821',
      },
      signal: { published: true },
      prediction: {
        outcome: 'APPLIED',
        movement: {
          accountId: 'account-1',
          cardId: null,
          amount: 125.5,
          currency: 'DOP',
          type: 'DEBIT',
          status: 'CONFIRMED',
          transactionDate: '2026-11-01T00:00:00.000Z',
          description: 'Farmacia',
          categoryId: null,
          legRole: null,
          externalReference: 'BHD-1',
          importReference: 'email-message-1',
        },
      },
    },
  ],
};

const startedJob = {
  id: 'job-1',
  status: 'QUEUED',
  dryRun: true,
  progress: { processed: 0, total: 1 },
  result: null,
  error: null,
  createdAt: '2026-11-19T10:00:00.000Z',
  startedAt: null,
  finishedAt: null,
};

const finishedJob = {
  ...startedJob,
  status: 'COMPLETED',
  progress: { processed: 1, total: 1 },
  result: manifest,
  startedAt: '2026-11-19T10:00:01.000Z',
  finishedAt: '2026-11-19T10:04:22.000Z',
};

describe('Email sample import API (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  const sampleImport = {
    start: jest.fn().mockResolvedValue(startedJob),
    getForUser: jest.fn().mockResolvedValue(startedJob),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    token = createTestJwt({ sub: 'user-123' });
    const moduleFixture = await applyE2eTestOverrides(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue(createPrismaMock())
        .overrideProvider(EmailSampleImportService)
        .useValue(sampleImport),
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

  afterEach(async () => app?.close());

  it('answers the job reference before the preview finishes', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/intelligence/email/sample-import')
      .set('Authorization', `Bearer ${token}`)
      .send({ dryRun: true, selection: { messageIds: ['message-1'] } })
      .expect(202);

    expect(response.body.data).toMatchObject({
      id: 'job-1',
      status: 'QUEUED',
      dryRun: true,
      progress: { processed: 0, total: 1 },
      result: null,
    });
    expect(sampleImport.start).toHaveBeenCalledWith({
      userId: 'user-123',
      dryRun: true,
      selection: {
        messageIds: ['message-1'],
        sender: undefined,
        dateFrom: undefined,
        dateTo: undefined,
      },
    });
  });

  it('returns the state and progress of a running job', async () => {
    sampleImport.getForUser.mockResolvedValueOnce({
      ...startedJob,
      status: 'RUNNING',
      progress: { processed: 1, total: 2 },
      startedAt: '2026-11-19T10:00:01.000Z',
    });

    const response = await request(app.getHttpServer())
      .get('/api/intelligence/email/sample-import/job-1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.data).toMatchObject({
      id: 'job-1',
      status: 'RUNNING',
      progress: { processed: 1, total: 2 },
      result: null,
    });
    expect(sampleImport.getForUser).toHaveBeenCalledWith('user-123', 'job-1');
  });

  it('returns the terminal manifest of a finished job', async () => {
    sampleImport.getForUser.mockResolvedValueOnce(finishedJob);

    const response = await request(app.getHttpServer())
      .get('/api/intelligence/email/sample-import/job-1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.data).toMatchObject({
      status: 'COMPLETED',
      progress: { processed: 1, total: 1 },
      finishedAt: '2026-11-19T10:04:22.000Z',
    });
    expect(response.body.data.result).toMatchObject({
      dryRun: true,
      summary: { included: 1, wouldCreateMovement: 1 },
      items: [{ provider: 'groq', model: 'test-model' }],
      selection: { mode: 'IDS', requested: 1, included: 1 },
    });
  });

  it('returns all review reasons in the terminal manifest', async () => {
    sampleImport.getForUser.mockResolvedValueOnce({
      ...finishedJob,
      result: {
        ...manifest,
        items: [
          {
            ...manifest.items[0],
            prediction: {
              outcome: 'REVIEW_REQUIRED',
              reason: 'NO_LEDGER_TARGET',
              reviewReasons: ['NO_LEDGER_TARGET', 'TRANSACTION_DATE_SUGGESTED'],
            },
          },
        ],
      },
    });

    const response = await request(app.getHttpServer())
      .get('/api/intelligence/email/sample-import/job-1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.data.result.items[0].prediction).toMatchObject({
      reason: 'NO_LEDGER_TARGET',
      reviewReasons: ['NO_LEDGER_TARGET', 'TRANSACTION_DATE_SUGGESTED'],
    });
  });

  it('does not reveal the job of another owner', async () => {
    sampleImport.getForUser.mockRejectedValueOnce(new NotFoundException());

    await request(app.getHttpServer())
      .get('/api/intelligence/email/sample-import/job-1')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('accepts a sender window with dates', async () => {
    await request(app.getHttpServer())
      .post('/api/intelligence/email/sample-import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        dryRun: true,
        selection: {
          sender: 'bhd.com.do',
          dateFrom: '2026-10-26T00:00:00.000Z',
          dateTo: '2026-11-02T23:59:59.999Z',
        },
      })
      .expect(202);
    expect(sampleImport.start).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: expect.objectContaining({ sender: 'bhd.com.do' }),
      }),
    );
  });

  it('accepts up to fifty ids in dry run', async () => {
    const messageIds = Array.from({ length: 21 }, (_, index) => `m-${index}`);

    await request(app.getHttpServer())
      .post('/api/intelligence/email/sample-import')
      .set('Authorization', `Bearer ${token}`)
      .send({ dryRun: true, selection: { messageIds } })
      .expect(202);
    expect(sampleImport.start).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true }),
    );
  });

  it('rejects more than fifty ids before touching the service', async () => {
    const messageIds = Array.from({ length: 51 }, (_, index) => `m-${index}`);

    await request(app.getHttpServer())
      .post('/api/intelligence/email/sample-import')
      .set('Authorization', `Bearer ${token}`)
      .send({ dryRun: true, selection: { messageIds } })
      .expect(400);
    expect(sampleImport.start).not.toHaveBeenCalled();
  });

  it('requires a boolean dryRun', async () => {
    await request(app.getHttpServer())
      .post('/api/intelligence/email/sample-import')
      .set('Authorization', `Bearer ${token}`)
      .send({ selection: { messageIds: ['message-1'] } })
      .expect(400);
    expect(sampleImport.start).not.toHaveBeenCalled();
  });
});
