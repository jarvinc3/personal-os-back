import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from './../src/prisma/prisma.service';
import { createPrismaMock } from './helpers/prisma.mock';
import { applyTestEnv } from './helpers/test-env';

applyTestEnv();

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const { AppModule } = require('../src/app.module') as {
      AppModule: new (...args: never[]) => unknown;
    };
    const prismaMock = createPrismaMock();
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
});
