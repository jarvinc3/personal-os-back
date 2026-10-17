import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '@personal-os/database';
import { applyAuthTestOverrides } from './helpers/auth-test.providers';
import { createTestJwt } from './helpers/jwt.helper';
import { createPrismaMock } from './helpers/prisma.mock';
import { applyTestEnv } from './helpers/test-env';

applyTestEnv();

// Loaded at file scope so the one-time ts-jest transpile of the app graph
// does not consume the 5s hook timeout on a cold cache (#150).
const { AppModule } = require('../apps/api/src/app.module') as {
  AppModule: new (...args: never[]) => unknown;
};

const SHARE_BODY = {
  receivableIds: ['rec-1'],
  debtorName: 'Carlos Méndez',
};

const PUBLIC_SHARE_PATH = '/api/public/receivable-shares/tok-1';

function receivableRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rec-1',
    description: 'Préstamo celular',
    notes: 'Samsung A15',
    amount: 8500,
    paidAmount: 3000,
    currency: 'DOP',
    status: 'PARTIAL',
    dueDate: new Date('2026-10-30T00:00:00.000Z'),
    createdAt: new Date('2026-09-12T00:00:00.000Z'),
    payments: [{ paidAt: new Date('2026-10-10T00:00:00.000Z'), amount: 2000 }],
    ...overrides,
  };
}

function shareRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'share-1',
    debtorName: 'Carlos Méndez',
    updatedAt: new Date('2026-10-16T19:30:00.000Z'),
    isActive: true,
    revokedAt: null,
    expiresAt: null,
    user: { fullName: 'Jarvin Collado', timezone: 'America/Santo_Domingo' },
    items: [{ receivable: receivableRow() }],
    ...overrides,
  };
}

describe('Receivable shares (e2e)', () => {
  let app: INestApplication<App>;
  let prismaMock: ReturnType<typeof createPrismaMock>;
  let token: string;

  beforeEach(async () => {
    prismaMock = createPrismaMock();
    token = createTestJwt({ sub: 'user-123' });

    const moduleFixture: TestingModule = await applyAuthTestOverrides(
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

  function createShare(body: Record<string, unknown> = SHARE_BODY) {
    return request(app.getHttpServer())
      .post('/api/finance/receivable-shares')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  it('creates the link, serves it in public and stops serving it after revoke', async () => {
    prismaMock.finReceivable.findMany.mockResolvedValue([{ id: 'rec-1' }]);
    prismaMock.finReceivableShare.create.mockResolvedValue({
      id: 'share-1',
      userId: 'user-123',
      token: 'tok-1',
      debtorName: 'Carlos Méndez',
      isActive: true,
      expiresAt: null,
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const created = await createShare().expect(201);

    expect(created.body.data.token).toBe('tok-1');
    expect(created.body.data.url).toMatch(/\/c\/tok-1$/);
    expect(created.body.data.items).toEqual(['rec-1']);
    expect(prismaMock.finReceivableShareItem.createMany).toHaveBeenCalledWith({
      data: [{ shareId: 'share-1', receivableId: 'rec-1' }],
    });

    prismaMock.finReceivableShare.findUnique.mockResolvedValue(shareRow());
    const publicRead = await request(app.getHttpServer())
      .get(PUBLIC_SHARE_PATH)
      .expect(200);

    expect(publicRead.headers['x-robots-tag']).toBe('noindex');
    expect(publicRead.body.data).toMatchObject({
      ownerFirstName: 'Jarvin',
      debtorName: 'Carlos Méndez',
      totalsByCurrency: [
        { currency: 'DOP', amount: '8500', paid: '3000', pending: '5500' },
      ],
    });
    const publicPayload = JSON.stringify(publicRead.body);
    expect(publicPayload).not.toContain('accountId');
    expect(publicPayload).not.toContain('institutionId');
    expect(publicPayload).not.toContain('rec-1');

    prismaMock.finReceivableShare.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.finReceivableShare.findFirst.mockResolvedValue({
      ...shareRow({ isActive: false, revokedAt: new Date() }),
      _count: { items: 1 },
    });
    const revoked = await request(app.getHttpServer())
      .patch('/api/finance/receivable-shares/share-1/revoke')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(revoked.body.data.isActive).toBe(false);

    prismaMock.finReceivableShare.findUnique.mockResolvedValue(
      shareRow({ isActive: false, revokedAt: new Date() }),
    );
    await request(app.getHttpServer()).get(PUBLIC_SHARE_PATH).expect(404);
  });

  it('keeps one total per currency, without converting', async () => {
    prismaMock.finReceivableShare.findUnique.mockResolvedValue(
      shareRow({
        items: [
          { receivable: receivableRow() },
          {
            receivable: receivableRow({
              id: 'rec-2',
              currency: 'USD',
              amount: 400,
              paidAmount: 0,
              status: 'PENDING',
            }),
          },
        ],
      }),
    );

    const response = await request(app.getHttpServer())
      .get(PUBLIC_SHARE_PATH)
      .expect(200);

    expect(response.body.data.totalsByCurrency).toEqual([
      { currency: 'DOP', amount: '8500', paid: '3000', pending: '5500' },
      { currency: 'USD', amount: '400', paid: '0', pending: '400' },
    ]);
    expect(
      response.body.data.items.map(
        (item: { currency: string }) => item.currency,
      ),
    ).toEqual(['DOP', 'USD']);
  });

  it('answers a generic 404 for an unknown token', async () => {
    prismaMock.finReceivableShare.findUnique.mockResolvedValue(null);

    await request(app.getHttpServer())
      .get('/api/public/receivable-shares/not-a-real-token')
      .expect(404);
  });

  it('rejects duplicated receivable ids', async () => {
    await createShare({
      receivableIds: ['rec-1', 'rec-1'],
      debtorName: 'Carlos Méndez',
    }).expect(400);

    expect(prismaMock.finReceivableShare.create).not.toHaveBeenCalled();
  });

  it('rejects a receivable that does not belong to the user', async () => {
    prismaMock.finReceivable.findMany.mockResolvedValue([]);

    await createShare().expect(404);

    expect(prismaMock.finReceivableShare.create).not.toHaveBeenCalled();
  });

  it('throttles the public endpoint by IP', async () => {
    prismaMock.finReceivableShare.findUnique.mockResolvedValue(shareRow());

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const response = await request(app.getHttpServer()).get(
        PUBLIC_SHARE_PATH,
      );
      statuses.push(response.status);
      if (response.status === 429) {
        break;
      }
    }

    expect(statuses).toContain(429);
  });
});
