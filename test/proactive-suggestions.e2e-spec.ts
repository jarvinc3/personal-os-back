import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '@personal-os/database';
import { AiProactiveService } from '@personal-os/intelligence';
import { applyE2eTestOverrides } from './helpers/e2e-test.providers';
import { createTestJwt } from './helpers/jwt.helper';
import { createPrismaMock } from './helpers/prisma.mock';

const { AppModule } = require('../apps/api/src/app.module') as {
  AppModule: new (...args: never[]) => unknown;
};

const listing = {
  suggestions: [
    {
      id: 'suggestion-1',
      signalId: 'signal-1',
      signalType: 'FINANCE.TRANSACTION_DETECTED',
      title: 'Tenés un movimiento por revisar',
      body: 'Quedó esperando una decisión.',
      actionId: null,
      createdAt: '2026-11-19T18:00:00.000Z',
    },
  ],
  limits: { discarded: 2, windowStartedAt: '2026-11-19T18:03:00.000Z' },
};

describe('Proactive suggestions API (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  const proactive = {
    listForUser: jest.fn().mockResolvedValue(listing),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    token = createTestJwt({ sub: 'user-123' });
    const moduleFixture = await applyE2eTestOverrides(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue(createPrismaMock())
        .overrideProvider(AiProactiveService)
        .useValue(proactive),
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

  it('lists the suggestions of the owner with the discarded count', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/intelligence/proactive-suggestions')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(proactive.listForUser).toHaveBeenCalledWith('user-123');
    expect(response.body.data).toMatchObject({
      suggestions: [
        {
          id: 'suggestion-1',
          signalId: 'signal-1',
          signalType: 'FINANCE.TRANSACTION_DETECTED',
          actionId: null,
        },
      ],
      limits: { discarded: 2, windowStartedAt: '2026-11-19T18:03:00.000Z' },
    });
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer())
      .get('/api/intelligence/proactive-suggestions')
      .expect(401);
    expect(proactive.listForUser).not.toHaveBeenCalled();
  });
});
