import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestJwt } from './helpers/jwt.helper';
import { createPrismaMock, type PrismaMock } from './helpers/prisma.mock';
import { applyTestEnv } from './helpers/test-env';

applyTestEnv();

describe('Users (e2e)', () => {
  let app: INestApplication<App>;
  let prismaMock: PrismaMock;

  beforeEach(async () => {
    const { AppModule } = require('../src/app.module') as {
      AppModule: new (...args: never[]) => unknown;
    };
    prismaMock = createPrismaMock();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('GET /api/users/me returns profile when user exists', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-123',
      email: 'user@example.com',
      fullName: 'User Test',
      timezone: 'America/Santo_Domingo',
      locale: 'es-DO',
      avatarUrl: null,
      preferences: {},
    });

    const token = createTestJwt({ sub: 'user-123', email: 'user@example.com' });

    await request(app.getHttpServer())
      .get('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          data: {
            id: 'user-123',
          },
          meta: {
            path: '/api/users/me',
          },
        });
      });
  });

  it('GET /api/users/me returns 404 when user does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const token = createTestJwt({ sub: 'missing-user' });

    await request(app.getHttpServer())
      .get('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(404)
      .expect((res) => {
        expect(res.body).toMatchObject({
          statusCode: 404,
          message: 'User not found',
          path: '/api/users/me',
        });
      });
  });

  it('PATCH /api/users/me updates partial profile and returns envelope', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-123',
      email: 'user@example.com',
      fullName: 'User Test',
      timezone: 'America/Santo_Domingo',
      locale: 'es-DO',
      avatarUrl: null,
      preferences: {},
    });
    prismaMock.user.update.mockResolvedValue({
      id: 'user-123',
      email: 'user@example.com',
      fullName: 'Updated Name',
      timezone: 'America/Santo_Domingo',
      locale: 'es-DO',
      avatarUrl: null,
      preferences: {
        theme: 'dark',
      },
    });

    const token = createTestJwt({ sub: 'user-123', email: 'user@example.com' });

    await request(app.getHttpServer())
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fullName: 'Updated Name',
        preferences: { theme: 'dark' },
      })
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          data: {
            fullName: 'Updated Name',
            preferences: {
              theme: 'dark',
            },
          },
          meta: {
            path: '/api/users/me',
          },
        });
      });
  });
});
