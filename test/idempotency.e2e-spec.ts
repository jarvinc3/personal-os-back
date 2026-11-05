import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '@personal-os/database';
import { applyE2eTestOverrides } from './helpers/e2e-test.providers';
import { createTestJwt } from './helpers/jwt.helper';
import { createPrismaMock } from './helpers/prisma.mock';

// Loaded at file scope so the one-time ts-jest transpile of the app graph
// does not consume the 5s hook timeout on a cold cache (#150).
const { AppModule } = require('../apps/api/src/app.module') as {
  AppModule: new (...args: never[]) => unknown;
};

const ACCOUNT_BODY = { name: 'Efectivo', type: 'CASH' };

describe('Idempotency-Key (e2e)', () => {
  let app: INestApplication<App>;
  let prismaMock: ReturnType<typeof createPrismaMock>;
  let token: string;

  beforeEach(async () => {
    prismaMock = createPrismaMock();
    // The cash-institution flow already finds an "Efectivo" account, so the
    // request only creates the account under test.
    prismaMock.finAccount.findFirst.mockResolvedValue({ id: 'acc-existing' });
    prismaMock.finAccount.create.mockResolvedValue({
      id: 'acc-cash',
      userId: 'user-123',
      name: 'Efectivo',
      type: 'CASH',
      institutionId: null,
      currency: 'DOP',
      balance: { toString: () => '0.00' },
      color: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      institutionRef: null,
    });
    token = createTestJwt({ sub: 'user-123' });

    const moduleFixture: TestingModule = await applyE2eTestOverrides(
      Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(PrismaService)
        .useValue(prismaMock),
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

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  function postAccount(idempotencyKey: string) {
    return request(app.getHttpServer())
      .post('/api/finance/accounts')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(ACCOUNT_BODY);
  }

  it('replays the stored response for the same key and body', async () => {
    const firstResponse = await postAccount('key-1').expect(201);
    const replayedResponse = await postAccount('key-1').expect(201);

    expect(replayedResponse.body).toEqual(firstResponse.body);
    expect(prismaMock.finAccount.create).toHaveBeenCalledTimes(1);
  });

  it('answers 409 when the same key is reused with another body', async () => {
    await postAccount('key-2').expect(201);

    await request(app.getHttpServer())
      .post('/api/finance/accounts')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'key-2')
      .send({ name: 'Otro', type: 'CASH' })
      .expect(409);
    expect(prismaMock.finAccount.create).toHaveBeenCalledTimes(1);
  });

  it('runs the handler again for a different key', async () => {
    await postAccount('key-3').expect(201);
    await postAccount('key-4').expect(201);

    expect(prismaMock.finAccount.create).toHaveBeenCalledTimes(2);
  });

  it('keeps the previous behavior when the header is absent', async () => {
    await request(app.getHttpServer())
      .post('/api/finance/accounts')
      .set('Authorization', `Bearer ${token}`)
      .send(ACCOUNT_BODY)
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/finance/accounts')
      .set('Authorization', `Bearer ${token}`)
      .send(ACCOUNT_BODY)
      .expect(201);

    expect(prismaMock.finAccount.create).toHaveBeenCalledTimes(2);
  });
});
