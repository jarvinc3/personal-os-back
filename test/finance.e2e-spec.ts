import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createPrismaMock } from './helpers/prisma.mock';
import { applyTestEnv } from './helpers/test-env';
import { createTestJwt } from './helpers/jwt.helper';

applyTestEnv();

describe('Finance (e2e)', () => {
  let app: INestApplication<App>;
  let prismaMock: ReturnType<typeof createPrismaMock>;
  let token: string;

  beforeEach(async () => {
    const { AppModule } = require('../src/app.module') as {
      AppModule: new (...args: never[]) => unknown;
    };
    prismaMock = createPrismaMock();
    token = createTestJwt({ sub: 'user-123' });

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

  it('GET /api/finance/accounts returns accounts', async () => {
    prismaMock.finAccount.findMany.mockResolvedValue([
      {
        id: 'acc-1',
        userId: 'user-123',
        name: 'Main',
        type: 'CHECKING',
        institution: null,
        currency: 'DOP',
        balance: { toString: () => '1000.00' },
        creditLimit: null,
        statementClosingDay: null,
        paymentDueDay: null,
        color: null,
        isActive: true,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      },
    ]);

    await request(app.getHttpServer())
      .get('/api/finance/accounts')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toMatchObject({
          id: 'acc-1',
          name: 'Main',
          balance: '1000.00',
        });
      });
  });

  it('POST /api/finance/accounts creates account', async () => {
    prismaMock.finAccount.create.mockResolvedValue({
      id: 'acc-new',
      userId: 'user-123',
      name: 'Savings',
      type: 'SAVINGS',
      institution: 'Bank',
      currency: 'DOP',
      balance: { toString: () => '0.00' },
      creditLimit: null,
      statementClosingDay: null,
      paymentDueDay: null,
      color: '#fff',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await request(app.getHttpServer())
      .post('/api/finance/accounts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Savings',
        type: 'SAVINGS',
        institution: 'Bank',
      })
      .expect(201)
      .expect((res) => {
        expect(res.body.data.name).toBe('Savings');
      });
  });
});
