import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '@personal-os/database';
import { AiEvidenceService } from '@personal-os/ai-agent';
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

  beforeEach(async () => {
    token = createTestJwt({ sub: 'user-123' });
    const moduleFixture = await applyAuthTestOverrides(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue(createPrismaMock())
        .overrideProvider(AiEvidenceService)
        .useValue(evidence),
    ).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();
  });

  afterEach(async () => app?.close());

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
    expect(evidence.reviewQueue).toHaveBeenCalledWith('user-123', 'next-page');

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
});
