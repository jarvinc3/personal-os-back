import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { applyAuthTestOverrides } from './helpers/auth-test.providers';
import { createPrismaMock } from './helpers/prisma.mock';
import { applyTestEnv } from './helpers/test-env';
import { createTestJwt } from './helpers/jwt.helper';

applyTestEnv();

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const { AppModule } = require('../src/app.module') as {
      AppModule: new (...args: never[]) => unknown;
    };
    const prismaMock = createPrismaMock();

    const moduleFixture: TestingModule = await applyAuthTestOverrides(
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
