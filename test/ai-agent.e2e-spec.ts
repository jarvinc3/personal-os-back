import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '@personal-os/database';
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

  beforeEach(async () => {
    token = createTestJwt({ sub: 'user-123' });
    const moduleFixture = await applyAuthTestOverrides(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue(createPrismaMock()),
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
});
