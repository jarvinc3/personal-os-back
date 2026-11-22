import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { getPrismaClientClass, PrismaService } from '@personal-os/database';
import { AiSignalConsumerRegistry } from '@personal-os/intelligence';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
// eslint-disable-next-line no-restricted-imports -- El barrel no expone estos servicios internos.
import { EmailProductProposalsController } from '../../packages/intelligence/src/email/email-product-proposals.controller';
// eslint-disable-next-line no-restricted-imports -- El barrel no expone estos servicios internos.
import { EmailProductProposalCatalogRegistry } from '../../packages/intelligence/src/email/email-product-proposal-catalog.registry';
// eslint-disable-next-line no-restricted-imports -- El barrel no expone estos servicios internos.
import { EmailProductProposalsService } from '../../packages/intelligence/src/email/email-product-proposals.service';
// eslint-disable-next-line no-restricted-imports -- El barrel no expone estos servicios internos.
import { AiSignalsService } from '../../packages/intelligence/src/signals/ai-signals.service';
// eslint-disable-next-line no-restricted-imports -- The integration test drives the controller against a real database.
import { CatalogAccountRepository } from '../../packages/finance/src/catalog/infrastructure/catalog-account.repository';
// eslint-disable-next-line no-restricted-imports -- The integration test wires the repositories against a real database.
import { CatalogCardRepository } from '../../packages/finance/src/catalog/infrastructure/catalog-card.repository';
// eslint-disable-next-line no-restricted-imports -- The integration test wires the repositories against a real database.
import { CatalogInstitutionRepository } from '../../packages/finance/src/catalog/infrastructure/catalog-institution.repository';
// eslint-disable-next-line no-restricted-imports -- The integration test wires the Finance adapter directly.
import { FinanceEmailProductProposalCatalog } from '../../packages/finance/src/catalog/application/email-product-proposal-catalog';

const connectionString = process.env.TEST_DATABASE_URL;
if (
  !connectionString ||
  !['localhost', '127.0.0.1', '[::1]'].includes(
    new URL(connectionString).hostname,
  )
) {
  throw new Error(
    'Proposal integration tests require a migrated local TEST_DATABASE_URL',
  );
}

const pool = new Pool({ connectionString, max: 4 });
const PrismaClient = getPrismaClientClass();
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const prismaService = prisma as unknown as PrismaService;
const createdUserIds = new Set<string>();

function draft(lastFour = '0016') {
  return {
    productType: 'ACCOUNT',
    name: 'Cuenta BHD ****0016',
    lastFour,
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

async function createUser(): Promise<string> {
  const userId = randomUUID();
  createdUserIds.add(userId);
  await prisma.user.create({
    data: {
      id: userId,
      email: `${userId}@proposal.integration.test`,
      fullName: 'Proposal integration',
    },
  });
  return userId;
}

async function createInstitution(
  userId: string,
  overrides: {
    name?: string;
    type?: string;
    isSystem?: boolean;
    domain?: string | null;
  } = {},
): Promise<string> {
  const institution = await prisma.finInstitution.create({
    data: {
      userId,
      name: overrides.name ?? 'BHD',
      type: overrides.type ?? 'bank',
      domain: overrides.domain === undefined ? 'bhd.com.do' : overrides.domain,
      country: 'DO',
      isSystem: overrides.isSystem ?? false,
    },
    select: { id: true },
  });
  return institution.id;
}

async function createAccount(
  userId: string,
  institutionId: string | null,
  overrides: {
    lastFour?: string | null;
    isActive?: boolean;
    type?: 'CHECKING' | 'SAVINGS' | 'CASH';
  } = {},
): Promise<string> {
  const account = await prisma.finAccount.create({
    data: {
      userId,
      institutionId,
      name: 'Ahorros BHD',
      type: overrides.type ?? 'SAVINGS',
      currency: 'DOP',
      accountNumberLast4:
        overrides.lastFour === undefined ? '0016' : overrides.lastFour,
      isActive: overrides.isActive ?? true,
    },
    select: { id: true },
  });
  return account.id;
}

async function createCard(
  userId: string,
  institutionId: string,
  lastFour = '6506',
): Promise<string> {
  const card = await prisma.finCard.create({
    data: {
      userId,
      institutionId,
      name: 'Visa BHD',
      type: 'CREDIT',
      lastFour,
    },
    select: { id: true },
  });
  return card.id;
}

async function createProposal(
  userId: string,
  overrides: { lastFour?: string } = {},
): Promise<string> {
  const lastFour = overrides.lastFour ?? '0016';
  const proposal = await prisma.aiEmailProductProposal.create({
    data: {
      userId,
      productType: 'ACCOUNT',
      deduplicationKey: `bhd.com.do:ACCOUNT:${lastFour}`,
      draft: draft(lastFour),
    },
    select: { id: true },
  });
  return proposal.id;
}

describe('Email product proposals with PostgreSQL', () => {
  let app: INestApplication<App>;
  let currentUserId = '';

  beforeAll(async () => {
    const adapter = new FinanceEmailProductProposalCatalog(
      {} as never,
      new CatalogAccountRepository(prismaService, {} as never),
      new CatalogCardRepository(prismaService, {} as never),
      new CatalogInstitutionRepository(prismaService, {} as never),
    );
    const moduleRef = await Test.createTestingModule({
      controllers: [EmailProductProposalsController],
      providers: [
        EmailProductProposalsService,
        { provide: PrismaService, useValue: prismaService },
        {
          provide: EmailProductProposalCatalogRegistry,
          useValue: { get: () => adapter },
        },
        {
          provide: AiSignalConsumerRegistry,
          useValue: {
            get: () => ({
              consume: jest.fn(),
              preview: jest.fn(),
            }),
          },
        },
        {
          provide: AiSignalsService,
          useValue: { recordConsumerOutcome: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: { get: () => 'test' },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use((req, _res, next) => {
      (req as { user?: { sub: string } }).user = { sub: currentUserId };
      next();
    });
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
    await prisma.user.deleteMany({
      where: { id: { in: [...createdUserIds] } },
    });
    createdUserIds.clear();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    await pool.end();
  });

  it('marks the compatible institution and product of a pending proposal', async () => {
    currentUserId = await createUser();
    const institutionId = await createInstitution(currentUserId);
    const accountId = await createAccount(currentUserId, institutionId);
    const proposalId = await createProposal(currentUserId);

    const response = await request(app.getHttpServer())
      .get('/intelligence/email/product-proposals?status=PENDING')
      .expect(200);

    const listed = response.body.find(
      (item: { id: string }) => item.id === proposalId,
    );
    expect(listed.matchedProductId).toBe(accountId);
    expect(listed.draft.institution.matchedInstitutionId).toBe(institutionId);
  });

  it('links the native product, keeps the last four and is idempotent', async () => {
    currentUserId = await createUser();
    const institutionId = await createInstitution(currentUserId);
    const accountId = await createAccount(currentUserId, institutionId, {
      lastFour: '9999',
    });
    const proposalId = await createProposal(currentUserId);

    const response = await request(app.getHttpServer())
      .post(`/intelligence/email/product-proposals/${proposalId}/approve`)
      .send({ productId: accountId })
      .expect(201);

    expect(response.body.status).toBe('APPROVED');
    expect(response.body.approvedProductId).toBe(accountId);
    expect(response.body.draft.lastFour).toBe('9999');
    expect(response.body.approval).toEqual({
      duplicate: false,
      productId: accountId,
      reevaluatedSignals: 0,
    });
    expect(
      await prisma.finAccount.count({ where: { userId: currentUserId } }),
    ).toBe(1);
    expect(
      await prisma.finInstitution.count({ where: { userId: currentUserId } }),
    ).toBe(1);

    const repeated = await request(app.getHttpServer())
      .post(`/intelligence/email/product-proposals/${proposalId}/approve`)
      .send({ productId: accountId })
      .expect(201);

    expect(repeated.body.status).toBe('APPROVED');
    expect(repeated.body).not.toHaveProperty('approval');
  });

  it('rejects a product of another user', async () => {
    currentUserId = await createUser();
    const proposalId = await createProposal(currentUserId);
    const otherUserId = await createUser();
    const otherInstitutionId = await createInstitution(otherUserId);
    const otherAccountId = await createAccount(otherUserId, otherInstitutionId);

    const response = await request(app.getHttpServer())
      .post(`/intelligence/email/product-proposals/${proposalId}/approve`)
      .send({ productId: otherAccountId })
      .expect(404);

    expect(response.body.message).toContain('Producto no encontrado');
  });

  it('rejects an archived product', async () => {
    currentUserId = await createUser();
    const institutionId = await createInstitution(currentUserId);
    const accountId = await createAccount(currentUserId, institutionId, {
      isActive: false,
    });
    const proposalId = await createProposal(currentUserId);

    const response = await request(app.getHttpServer())
      .post(`/intelligence/email/product-proposals/${proposalId}/approve`)
      .send({ productId: accountId })
      .expect(409);

    expect(response.body.message).toContain('archivado');
  });

  it('rejects a product of another type', async () => {
    currentUserId = await createUser();
    const institutionId = await createInstitution(currentUserId);
    const cardId = await createCard(currentUserId, institutionId);
    const proposalId = await createProposal(currentUserId);

    const response = await request(app.getHttpServer())
      .post(`/intelligence/email/product-proposals/${proposalId}/approve`)
      .send({ productId: cardId })
      .expect(400);

    expect(response.body.message).toContain('cuenta');
  });

  it('rejects a cash product', async () => {
    currentUserId = await createUser();
    const cashInstitutionId = await createInstitution(currentUserId, {
      name: 'Efectivo',
      type: 'cash',
      isSystem: true,
      domain: null,
    });
    const accountId = await createAccount(currentUserId, cashInstitutionId, {
      type: 'CASH',
    });
    const proposalId = await createProposal(currentUserId);

    const response = await request(app.getHttpServer())
      .post(`/intelligence/email/product-proposals/${proposalId}/approve`)
      .send({ productId: accountId })
      .expect(400);

    expect(response.body.message).toContain('institución');
  });

  it('rejects a product without last four digits', async () => {
    currentUserId = await createUser();
    const institutionId = await createInstitution(currentUserId);
    const accountId = await createAccount(currentUserId, institutionId, {
      lastFour: null,
    });
    const proposalId = await createProposal(currentUserId);

    const response = await request(app.getHttpServer())
      .post(`/intelligence/email/product-proposals/${proposalId}/approve`)
      .send({ productId: accountId })
      .expect(400);

    expect(response.body.message).toContain('últimos 4');
  });
});
