import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '@personal-os/database';
import { applyE2eTestOverrides } from './helpers/e2e-test.providers';
import { createTestJwt } from './helpers/jwt.helper';
import { createPrismaMock, type PrismaMock } from './helpers/prisma.mock';

const { AppModule } = require('../apps/api/src/app.module') as {
  AppModule: new (...args: never[]) => unknown;
};

type StoredKnowledge = Record<string, unknown> & {
  scope: string;
  state: string;
  userId: string | null;
  knowledgeType: string;
  payload: { label: Record<string, unknown> };
};

const date = new Date('2026-10-25T12:00:00Z');

describe('AI-4 knowledge promotion (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let prismaMock: PrismaMock;
  let stored: StoredKnowledge[];
  const userRole = { findUnique: jest.fn().mockResolvedValue(null) };

  const messages = ['u1', 'u2', 'u3'].map((userId, index) => ({
    id: `m${index + 1}`,
    userId,
    fromAddress: `Alertas <alerts+${userId}@alerts.bank.com>`,
    subject: `Consumo RD$${index + 1},250 en tienda`,
  }));
  const verifications = messages.map((message, index) => ({
    sequence: BigInt(index + 1),
    userId: message.userId,
    targetId: message.id,
    targetType: 'EMAIL_MESSAGE',
    verdict: 'CORRECTED',
    verifierRole: 'USER',
    correctedPayload: {
      semanticType: 'FIN_TRANSACTION',
      routes: ['FINANCE'],
      transaction: {
        kind: 'TRANSACTION',
        amount: index + 1250,
        last4: '4821',
        merchant: 'Comercio Particular',
        bankReference: 'private-ref',
      },
    },
    isGroundTruth: false,
    createdAt: date,
  }));

  beforeEach(async () => {
    jest.clearAllMocks();
    token = createTestJwt({ sub: 'admin-1' });
    userRole.findUnique.mockResolvedValue({ role: 'ADMIN' });
    stored = [];
    prismaMock = createPrismaMock();
    prismaMock.aiEmailMessage.findMany.mockImplementation(
      (command?: { where?: { userId?: string } }) =>
        Promise.resolve(
          command?.where?.userId
            ? messages.filter(
                (message) => message.userId === command.where?.userId,
              )
            : messages,
        ),
    );
    prismaMock.aiDatasetItem.findMany.mockResolvedValue(
      messages.map((message) => ({
        sourceId: message.id,
        partition: 'TRAIN',
      })),
    );
    prismaMock.aiHumanVerification.aggregate.mockResolvedValue({
      _max: { sequence: 3n },
    });
    prismaMock.aiConsentEvent.aggregate.mockResolvedValue({
      _max: { sequence: 1n },
    });
    prismaMock.aiHumanVerification.findMany.mockImplementation(
      ({ where }: { where: { targetType: string } }) =>
        Promise.resolve(
          where.targetType === 'EMAIL_MESSAGE' ? verifications : [],
        ),
    );
    prismaMock.userAiSettings.findMany.mockResolvedValue(
      messages.map((message) => ({
        userId: message.userId,
        contributeToGlobalKnowledge: true,
      })),
    );
    prismaMock.aiKnowledge.deleteMany.mockImplementation(() => {
      stored = [];
      return Promise.resolve({ count: 0 });
    });
    prismaMock.aiKnowledge.createMany.mockImplementation(
      (command: { data: StoredKnowledge[] }) => {
        stored = command.data.map((row, index) => ({
          ...row,
          id: row.id ?? `item-${index}`,
        }));
        return Promise.resolve({ count: stored.length });
      },
    );
    prismaMock.aiKnowledge.findMany.mockImplementation(
      (command?: { where?: Record<string, unknown> }) => {
        const where = command?.where ?? {};
        return Promise.resolve(
          stored.filter((row) =>
            Object.entries(where).every(
              ([field, value]) => row[field] === value,
            ),
          ),
        );
      },
    );
    const moduleFixture = await applyE2eTestOverrides(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue({ ...prismaMock, userRole }),
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

  afterEach(async () => app?.close());

  it('promueve GLOBAL con datos de ejemplo y sin datos privados', async () => {
    const rebuild = await request(app.getHttpServer())
      .post('/api/intelligence/knowledge/admin/rebuild')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    expect(rebuild.body.data).toMatchObject({
      runId: 'run-1',
      observationSequence: '0',
      verificationSequence: '3',
      consentRevision: '1',
      items: 11,
    });

    const explorer = await request(app.getHttpServer())
      .get('/api/intelligence/knowledge')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const global = explorer.body.data.global as StoredKnowledge[];
    const domain = global.find((row) => row.knowledgeType === 'EMAIL_DOMAIN');
    expect(domain).toMatchObject({
      scope: 'GLOBAL',
      knowledgeKey: 'bank.com',
      state: 'STABLE',
      messagesSeen: 3,
      distinctUsers: 3,
      promotedBy: 'AUTO',
    });
    expect(global.some((row) => row.knowledgeType === 'EMAIL_SENDER')).toBe(
      false,
    );
    expect(JSON.stringify(global)).not.toContain('1250');
    expect(JSON.stringify(global)).not.toContain('4821');
    expect(JSON.stringify(global)).not.toContain('Comercio Particular');
    expect(explorer.body.data.personal).toEqual([]);

    const queue = await request(app.getHttpServer())
      .get('/api/intelligence/knowledge/admin/queue')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(queue.body.data).toHaveLength(global.length);
  });
});
