import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '@personal-os/database';
import {
  AiEvidenceService,
  AiKnowledgeService,
  AiDataDeletionService,
  SEMANTIC_ROUTES,
  SEMANTIC_TYPES,
  TRANSACTION_DIRECTIONS,
  TRANSACTION_KINDS,
} from '@personal-os/ai-agent';
import { applyAuthTestOverrides } from './helpers/auth-test.providers';
import { createTestJwt } from './helpers/jwt.helper';
import { createPrismaMock } from './helpers/prisma.mock';
import { applyTestEnv } from './helpers/test-env';

applyTestEnv();
const { AppModule } = require('../apps/api/src/app.module') as {
  AppModule: new (...args: never[]) => unknown;
};

describe('Retired AI chat API (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  const evidence = {
    datasetSummary: jest.fn().mockResolvedValue({
      id: 'dataset-1',
      name: 'EMAIL_V1',
      partitions: { TRAIN: 3, VALIDATION: 1, HOLDOUT: 1 },
    }),
    reviewQueue: jest.fn().mockResolvedValue({
      items: [],
      hasMore: false,
      nextCursor: null,
    }),
    verifyMessage: jest.fn().mockResolvedValue({
      sequence: '7',
      verdict: 'CONFIRMED',
    }),
    listRuns: jest.fn().mockResolvedValue([]),
  };
  const knowledge = {
    listForUser: jest.fn().mockResolvedValue({ personal: [], global: [] }),
    adminQueue: jest.fn().mockResolvedValue([]),
    rebuild: jest.fn().mockResolvedValue({ runId: 'run-1', items: 0 }),
    revert: jest.fn().mockResolvedValue({ state: 'BLOCKED' }),
  };
  const deletion = {
    exportForUser: jest.fn().mockResolvedValue({ messages: [], knowledge: [] }),
    deleteMyData: jest
      .fn()
      .mockResolvedValue({ deleted: true, deletedMessages: 0 }),
  };
  const userRole = { findUnique: jest.fn().mockResolvedValue(null) };

  beforeEach(async () => {
    token = createTestJwt({ sub: 'user-123' });
    const moduleFixture = await applyAuthTestOverrides(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue({ ...createPrismaMock(), userRole })
        .overrideProvider(AiEvidenceService)
        .useValue(evidence)
        .overrideProvider(AiKnowledgeService)
        .useValue(knowledge)
        .overrideProvider(AiDataDeletionService)
        .useValue(deletion),
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

  it('aísla el explorador/exportación y protege la cola ADMIN', async () => {
    userRole.findUnique.mockResolvedValue(null);
    await request(app.getHttpServer())
      .get('/api/intelligence/knowledge')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(knowledge.listForUser).toHaveBeenCalledWith('user-123');
    await request(app.getHttpServer())
      .get('/api/intelligence/knowledge/me/export')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(deletion.exportForUser).toHaveBeenCalledWith('user-123');
    await request(app.getHttpServer())
      .get('/api/intelligence/knowledge/admin/queue')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(knowledge.adminQueue).not.toHaveBeenCalled();
  });

  it('exige confirmación para borrar y permite reconstruir solo a ADMIN', async () => {
    await request(app.getHttpServer())
      .delete('/api/intelligence/knowledge/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ confirmed: false })
      .expect(400);
    await request(app.getHttpServer())
      .delete('/api/intelligence/knowledge/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ confirmed: true })
      .expect(200);
    expect(deletion.deleteMyData).toHaveBeenCalledWith('user-123');
    await request(app.getHttpServer())
      .post('/api/intelligence/knowledge/admin/rebuild')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    userRole.findUnique.mockResolvedValue({ role: 'ADMIN' });
    await request(app.getHttpServer())
      .post('/api/intelligence/knowledge/admin/rebuild')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(knowledge.rebuild).toHaveBeenCalledWith('user-123');
  });

  it('returns 404 for chat and session routes removed in AI-0', async () => {
    await request(app.getHttpServer())
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ messages: [{ role: 'user', content: 'hola' }] })
      .expect(404);
    await request(app.getHttpServer())
      .get('/api/ai/sessions')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('exposes the authenticated AI-3 dataset, review, verification, and run routes', async () => {
    await request(app.getHttpServer())
      .get('/api/intelligence/dataset')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.name).toBe('EMAIL_V1');
      });

    await request(app.getHttpServer())
      .get('/api/intelligence/review-queue?cursor=next-page')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(evidence.reviewQueue).toHaveBeenCalledWith(
      'user-123',
      'next-page',
      undefined,
    );

    await request(app.getHttpServer())
      .post('/api/intelligence/messages/message-1/verifications')
      .set('Authorization', `Bearer ${token}`)
      .send({ verdict: 'CONFIRMED' })
      .expect(201);
    expect(evidence.verifyMessage).toHaveBeenCalledWith(
      'user-123',
      'message-1',
      { verdict: 'CONFIRMED' },
    );

    await request(app.getHttpServer())
      .get('/api/intelligence/runs')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it.each([
    { semanticType: 'notificacion empleo' },
    { routes: ['FINANCE', 'FINANCE'] },
    { routes: ['TRAVEL'] },
    {
      semanticType: 'FIN_TRANSACTION',
      transaction: { kind: 'TRANSACTION', amount: -1 },
    },
    {
      semanticType: 'FIN_TRANSACTION',
      transaction: { kind: 'TRANSACTION', last4: '123' },
    },
    {
      semanticType: 'FIN_TRANSACTION',
      transaction: { kind: 'TRANSACTION', unknownField: 'x' },
    },
  ])('rejects an invalid label payload %# before persistence', async (body) => {
    evidence.verifyMessage.mockClear();
    await request(app.getHttpServer())
      .post('/api/intelligence/messages/message-1/verifications')
      .set('Authorization', `Bearer ${token}`)
      .send({ verdict: 'CORRECTED', ...body })
      .expect(400);
    expect(evidence.verifyMessage).not.toHaveBeenCalled();
  });

  it('accepts a typed financial transaction payload', async () => {
    evidence.verifyMessage.mockClear();
    await request(app.getHttpServer())
      .post('/api/intelligence/messages/message-1/verifications')
      .set('Authorization', `Bearer ${token}`)
      .send({
        verdict: 'CORRECTED',
        semanticType: 'FIN_TRANSACTION',
        routes: ['FINANCE'],
        transaction: {
          kind: 'TRANSACTION',
          amount: 1250,
          currency: 'DOP',
          direction: 'DEBIT',
        },
      })
      .expect(201);
    expect(evidence.verifyMessage).toHaveBeenCalledTimes(1);
  });

  it('publishes the exact label enums in OpenAPI', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Test').setVersion('1').build(),
    );
    const verification = document.components?.schemas
      ?.CreateHumanVerificationDto as { properties: Record<string, never> };
    const transaction = document.components?.schemas
      ?.HumanVerificationTransactionDto as {
      properties: Record<string, never>;
    };

    expect(verification.properties.semanticType).toMatchObject({
      enum: [...SEMANTIC_TYPES],
    });
    expect(verification.properties.routes).toMatchObject({
      items: { enum: [...SEMANTIC_ROUTES] },
    });
    expect(transaction.properties.kind).toMatchObject({
      enum: [...TRANSACTION_KINDS],
    });
    expect(transaction.properties.direction).toMatchObject({
      enum: [...TRANSACTION_DIRECTIONS],
    });
  });
});
