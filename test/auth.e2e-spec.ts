import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '@personal-os/database';
import { applyE2eTestOverrides } from './helpers/e2e-test.providers';
import { createPrismaMock } from './helpers/prisma.mock';
import { createTestJwt } from './helpers/jwt.helper';

// Loaded at file scope so the one-time ts-jest transpile of the app graph
// does not consume the 5s hook timeout on a cold cache (#150).
const { AppModule } = require('../apps/api/src/app.module') as {
  AppModule: new (...args: never[]) => unknown;
};

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const prismaMock = createPrismaMock();

    const moduleFixture: TestingModule = await applyE2eTestOverrides(
      Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(PrismaService)
        .useValue(prismaMock),
    ).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('GET /api/auth/session returns 401 without token', async () => {
    await request(app.getHttpServer()).get('/api/auth/session').expect(401);
  });

  it('GET /api/auth/session returns authenticated context with valid JWT', async () => {
    const token = createTestJwt({
      sub: 'user-123',
      email: 'auth-test@example.com',
    });

    await request(app.getHttpServer())
      .get('/api/auth/session')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          data: {
            sub: 'user-123',
            email: 'auth-test@example.com',
            role: 'authenticated',
          },
          meta: {
            path: '/api/auth/session',
          },
        });
      });
  });

  it('GET /api/auth/session returns 401 with expired JWT', async () => {
    const expiredToken = createTestJwt({ expiresIn: -10 });

    await request(app.getHttpServer())
      .get('/api/auth/session')
      .set('Authorization', `Bearer ${expiredToken}`)
      .expect(401);
  });
});
