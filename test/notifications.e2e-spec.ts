import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { applyAuthTestOverrides } from './helpers/auth-test.providers';
import { createTestJwt } from './helpers/jwt.helper';
import { createPrismaMock } from './helpers/prisma.mock';
import { applyTestEnv } from './helpers/test-env';

applyTestEnv();

const mockUser = {
  id: 'user-123',
  email: 'test@example.com',
  fullName: 'Test User',
  avatarUrl: null,
  timezone: 'America/Santo_Domingo',
  locale: 'es',
  preferences: {},
  userModules: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('Notifications (e2e)', () => {
  let app: INestApplication<App>;
  let prismaMock: ReturnType<typeof createPrismaMock>;
  let token: string;

  beforeEach(async () => {
    const { AppModule } = require('../src/app.module') as {
      AppModule: new (...args: never[]) => unknown;
    };
    prismaMock = createPrismaMock();
    token = createTestJwt({ sub: 'user-123' });

    prismaMock.user.findUnique.mockResolvedValue(mockUser);
    prismaMock.notification.create.mockResolvedValue({
      id: 'notif-1',
      userId: 'user-123',
      type: 'test',
      channel: 'IN_APP',
      title: 'Test',
      body: 'Body',
      data: { source: 'dev' },
      isRead: false,
      createdAt: new Date(),
    });

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

  it('POST /api/notifications creates dev notification', async () => {
    await request(app.getHttpServer())
      .post('/api/notifications')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'test',
        channel: 'IN_APP',
        title: 'Test',
        body: 'Body',
        data: { source: 'dev' },
      })
      .expect(201)
      .expect((res) => {
        expect(res.body.data).toMatchObject({
          id: 'notif-1',
          title: 'Test',
        });
      });

    expect(prismaMock.notification.create).toHaveBeenCalled();
  });

  it('GET /api/notifications/unread-count returns count', async () => {
    prismaMock.notification.count.mockResolvedValue(3);

    await request(app.getHttpServer())
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toEqual({ count: 3 });
      });
  });

  it('POST /api/notifications EMAIL with delivery disabled persists without 500', async () => {
    process.env.EMAIL_DELIVERY_ENABLED = 'false';
    prismaMock.notification.create.mockResolvedValue({
      id: 'notif-email-1',
      userId: 'user-123',
      type: 'test',
      channel: 'EMAIL',
      title: 'Email test',
      body: 'Body',
      data: { source: 'dev' },
      isRead: false,
      createdAt: new Date(),
    });

    await request(app.getHttpServer())
      .post('/api/notifications')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'test',
        channel: 'EMAIL',
        title: 'Email test',
        body: 'Body',
        data: { source: 'dev' },
      })
      .expect(201)
      .expect((res) => {
        expect(res.body.data).toMatchObject({
          id: 'notif-email-1',
          channel: 'EMAIL',
          title: 'Email test',
        });
      });

    expect(prismaMock.notification.create).toHaveBeenCalled();
  });
});
