import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '@personal-os/database';
import { applyE2eTestOverrides } from './helpers/e2e-test.providers';
import { createTestJwt } from './helpers/jwt.helper';
import { createPrismaMock } from './helpers/prisma.mock';

const { AppModule } = require('../apps/api/src/app.module') as {
  AppModule: new (...args: never[]) => unknown;
};

const USER_ID = 'user-123';
const PROPOSAL_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ACCOUNT_ID = '44444444-4444-4444-8444-444444444444';
const INSTITUTION_ID = '33333333-3333-4333-8333-333333333333';

function draft() {
  return {
    productType: 'ACCOUNT',
    name: 'Cuenta BHD ****0016',
    lastFour: '0016',
    currency: 'DOP',
    accountType: 'SAVINGS',
    cardType: null,
    network: null,
    accountId: null,
    institution: {
      name: 'BHD',
      type: 'bank',
      domain: 'bhd.com.do',
      country: 'DO',
    },
    accountNumberCiphertext: null,
    accountNumberHash: null,
  };
}

function proposalRow() {
  return {
    id: PROPOSAL_ID,
    userId: USER_ID,
    productType: 'ACCOUNT',
    status: 'PENDING',
    draft: draft(),
    approvedProductId: null,
    createdAt: new Date('2026-11-06T16:00:00.000Z'),
    evidence: [],
  };
}

function accountRow() {
  return {
    id: ACCOUNT_ID,
    userId: USER_ID,
    name: 'Ahorros BHD',
    type: 'SAVINGS',
    currency: 'DOP',
    balance: 0,
    accountNumber: null,
    accountNumberLast4: '0016',
    accountNumberHash: null,
    isDefaultForInstitution: false,
    color: null,
    isActive: true,
    institutionId: INSTITUTION_ID,
    institutionRef: {
      id: INSTITUTION_ID,
      name: 'BHD',
      type: 'bank',
      domain: 'bhd.com.do',
      isSystem: false,
    },
  };
}

describe('Email product proposals API (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let proposal: ReturnType<typeof proposalRow>;
  let prisma: ReturnType<typeof createPrismaMock> & {
    aiEmailProductProposal: Record<string, jest.Mock>;
    aiEmailProductProposalEvidence: Record<string, jest.Mock>;
  };

  beforeEach(async () => {
    proposal = proposalRow();
    const base = createPrismaMock();
    prisma = {
      ...base,
      aiEmailProductProposal: {
        findFirst: jest.fn(({ where }: { where: { id?: string } }) =>
          Promise.resolve(where.id === PROPOSAL_ID ? { ...proposal } : null),
        ),
        findMany: jest.fn(() => Promise.resolve([{ ...proposal }])),
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn(
          ({
            where,
            data,
          }: {
            where: { id?: string; userId?: string; status?: string };
            data: Record<string, unknown>;
          }) => {
            if (
              where.id !== PROPOSAL_ID ||
              where.userId !== USER_ID ||
              (where.status && proposal.status !== where.status)
            ) {
              return Promise.resolve({ count: 0 });
            }
            Object.assign(proposal, data);
            return Promise.resolve({ count: 1 });
          },
        ),
        upsert: jest.fn().mockResolvedValue({ id: PROPOSAL_ID }),
      },
      aiEmailProductProposalEvidence: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      finInstitution: {
        ...base.finInstitution,
        findMany: jest.fn().mockResolvedValue([
          {
            id: INSTITUTION_ID,
            name: 'BHD',
            type: 'bank',
            domain: 'bhd.com.do',
            isActive: true,
            isSystem: false,
          },
        ]),
      },
      finAccount: {
        ...base.finAccount,
        findMany: jest.fn(
          ({
            where,
          }: {
            where: {
              id?: { in?: string[] };
              userId?: string;
              accountNumberLast4?: string | { in?: string[] };
            };
          }) => {
            if (where.userId !== USER_ID) {
              return Promise.resolve([]);
            }
            const ids = where.id?.in;
            if (ids && !ids.includes(ACCOUNT_ID)) {
              return Promise.resolve([]);
            }
            const lastFours =
              typeof where.accountNumberLast4 === 'object'
                ? where.accountNumberLast4.in
                : where.accountNumberLast4
                  ? [where.accountNumberLast4]
                  : undefined;
            if (lastFours && !lastFours.includes('0016')) {
              return Promise.resolve([]);
            }
            return Promise.resolve([accountRow()]);
          },
        ),
      },
      finCard: {
        ...base.finCard,
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    token = createTestJwt({ sub: USER_ID });

    const moduleFixture = await applyE2eTestOverrides(
      Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(PrismaService)
        .useValue(prisma),
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

  it('lists the compatible institution and existing product of a pending proposal', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/intelligence/email/product-proposals?status=PENDING')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const [item] = response.body.data;
    expect(item.matchedProductId).toBe(ACCOUNT_ID);
    expect(item.matchedProductIds).toEqual([ACCOUNT_ID]);
    expect(item.draft.institution.matchedInstitutionId).toBe(INSTITUTION_ID);
    expect(item.draft.institution.matchedInstitutionIds).toEqual([
      INSTITUTION_ID,
    ]);
  });

  it('links the product sent in the body without creating anything', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/intelligence/email/product-proposals/${PROPOSAL_ID}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send({ productId: ACCOUNT_ID })
      .expect(201);

    expect(response.body.data.status).toBe('APPROVED');
    expect(response.body.data.approvedProductId).toBe(ACCOUNT_ID);
    expect(response.body.data.approval).toEqual({
      duplicate: false,
      productId: ACCOUNT_ID,
      reevaluatedSignals: 0,
    });
  });

  it('rejects a product that is not from the authenticated user', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/intelligence/email/product-proposals/${PROPOSAL_ID}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send({ productId: OTHER_ACCOUNT_ID })
      .expect(404);

    expect(response.body.message).toContain('Producto no encontrado');
  });

  it('rejects a body that is not a product id', async () => {
    await request(app.getHttpServer())
      .post(`/api/intelligence/email/product-proposals/${PROPOSAL_ID}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send({ productId: 'not-a-uuid' })
      .expect(400);
  });
});
