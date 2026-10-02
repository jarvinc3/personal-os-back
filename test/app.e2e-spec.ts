import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '@personal-os/database';
import { applyAuthTestOverrides } from './helpers/auth-test.providers';
import { createPrismaMock } from './helpers/prisma.mock';
import { applyTestEnv } from './helpers/test-env';

applyTestEnv();

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const { AppModule } = require('../apps/api/src/app.module') as {
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

  it('/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          data: {
            status: 'ok',
          },
          meta: {
            path: '/api/health',
          },
        });
      });
  });

  it('/health/ready (GET) is public and does not require JWT', async () => {
    // Without DB/JWKS available in unit e2e, we only assert auth is not required:
    // 401 would mean JWT guard still applies; 200/503 are acceptable outcomes.
    const res = await request(app.getHttpServer()).get('/api/health/ready');
    expect(res.status).not.toBe(401);
    expect([200, 503]).toContain(res.status);

    if (res.status === 200) {
      expect(res.body).toMatchObject({
        data: {
          status: 'ok',
          timestamp: expect.any(String),
        },
      });
      expect(res.body.data).not.toHaveProperty('info');
      expect(res.body.data).not.toHaveProperty('details');
    } else {
      expect(res.body.statusCode).toBe(503);
      expect(JSON.stringify(res.body)).not.toMatch(/database|jwks|redis/i);
    }
  });

  it('/health/startup (GET) is public and sanitized', async () => {
    const res = await request(app.getHttpServer()).get('/api/health/startup');
    expect(res.status).not.toBe(401);
    expect([200, 503]).toContain(res.status);

    if (res.status === 503) {
      expect(res.body.statusCode).toBe(503);
      expect(JSON.stringify(res.body)).not.toMatch(/database|jwks|redis/i);
    }
  });

  it('/admin/queues is not mounted under NODE_ENV=test', async () => {
    const atRoot = await request(app.getHttpServer()).get('/admin/queues');
    expect(atRoot.status).toBe(404);
    expect(atRoot.status).not.toBe(401);

    const underApi = await request(app.getHttpServer()).get(
      '/api/admin/queues',
    );
    expect(underApi.status).toBe(404);
    expect(underApi.status).not.toBe(401);
  });
});
