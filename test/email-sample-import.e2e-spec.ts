import { INestApplication, ValidationPipe } from '@nestjs/common';
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

describe('Email sample import API (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  const sampleImport = { run: jest.fn().mockResolvedValue(manifest) };

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

  it('returns the manifest of the selected ids in preview mode', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/intelligence/email/sample-import')
      .set('Authorization', `Bearer ${token}`)
      .send({ dryRun: true, selection: { messageIds: ['message-1'] } })
      .expect(201);

    expect(response.body.data).toMatchObject({
      dryRun: true,
      summary: { included: 1, wouldCreateMovement: 1 },
    });
    expect(sampleImport.run).toHaveBeenCalledWith({
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
      .expect(201);
    expect(sampleImport.run).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: expect.objectContaining({ sender: 'bhd.com.do' }),
      }),
    );
  });

  it('rejects more than twenty ids before touching the service', async () => {
    const messageIds = Array.from({ length: 21 }, (_, index) => `m-${index}`);

    await request(app.getHttpServer())
      .post('/api/intelligence/email/sample-import')
      .set('Authorization', `Bearer ${token}`)
      .send({ dryRun: true, selection: { messageIds } })
      .expect(400);
    expect(sampleImport.run).not.toHaveBeenCalled();
  });

  it('requires a boolean dryRun', async () => {
    await request(app.getHttpServer())
      .post('/api/intelligence/email/sample-import')
      .set('Authorization', `Bearer ${token}`)
      .send({ selection: { messageIds: ['message-1'] } })
      .expect(400);
    expect(sampleImport.run).not.toHaveBeenCalled();
  });
});
