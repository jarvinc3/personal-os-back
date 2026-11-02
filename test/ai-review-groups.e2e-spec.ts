import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '@personal-os/database';
import { applyAuthTestOverrides } from './helpers/auth-test.providers';
import { createTestJwt } from './helpers/jwt.helper';
import { createPrismaMock, type PrismaMock } from './helpers/prisma.mock';
import { applyTestEnv } from './helpers/test-env';

applyTestEnv();
const { AppModule } = require('../apps/api/src/app.module') as {
  AppModule: new (...args: never[]) => unknown;
};

type ReviewMessage = {
  id: string;
  userId: string;
  fromAddress: string;
  fromDomain: string;
  subject: string;
  templateFingerprint: string | null;
  receivedAt: Date;
};

type StoredPartition = {
  datasetId: string;
  userId: string;
  sourceType: string;
  sourceId: string;
  partition: 'TRAIN' | 'VALIDATION' | 'HOLDOUT';
};

type StoredVerificationInput = {
  userId: string;
  verifierRole: string;
  targetType: string;
  targetId: string;
  verdict: string;
  correctedPayload?: unknown;
  notes: string | null;
  isGroundTruth: boolean;
};

type StoredVerification = StoredVerificationInput & {
  sequence: bigint;
  createdAt: Date;
};

const receivedAt = new Date('2026-10-25T12:00:00Z');
const githubMessages: ReviewMessage[] = Array.from(
  { length: 100 },
  (_, index) => ({
    id: `g${index}`,
    userId: 'user-123',
    fromAddress: 'notifications@github.com',
    fromDomain: 'github.com',
    subject: index < 3 ? `Aviso ${index + 1}` : 'Aviso',
    templateFingerprint: 'fp-github',
    receivedAt: new Date(receivedAt.getTime() - index * 60_000),
  }),
);
const otherAccountMessages: ReviewMessage[] = Array.from(
  { length: 3 },
  (_, index) => ({
    id: `o${index}`,
    userId: 'other-user',
    fromAddress: 'only-other@example.com',
    fromDomain: 'example.com',
    subject: 'Correo ajeno',
    templateFingerprint: 'fp-other',
    receivedAt,
  }),
);

const partition = (
  message: ReviewMessage,
  messagePartition: StoredPartition['partition'],
): StoredPartition => ({
  datasetId: 'dataset-1',
  userId: message.userId,
  sourceType: 'EMAIL_MESSAGE',
  sourceId: message.id,
  partition: messagePartition,
});

describe('AI-6 review groups batch (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let prismaMock: PrismaMock;
  let messages: ReviewMessage[];
  let partitions: StoredPartition[];
  let verifications: StoredVerification[];
  const userRole = { findUnique: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    token = createTestJwt({ sub: 'user-123' });
    messages = [...githubMessages, ...otherAccountMessages];
    partitions = [
      ...githubMessages.map((message, index) =>
        partition(message, index >= 91 ? 'HOLDOUT' : 'TRAIN'),
      ),
      ...otherAccountMessages.map((message) => partition(message, 'TRAIN')),
    ];
    verifications = [];
    userRole.findUnique.mockResolvedValue({ role: 'ADMIN' });
    prismaMock = createPrismaMock();

    prismaMock.aiEmailMessage.findMany.mockImplementation(
      (command: {
        where?: {
          userId?: string;
          fromAddress?: string;
          templateFingerprint?: string | null;
        };
      }) => {
        const where = command.where ?? {};
        return Promise.resolve(
          messages.filter(
            (message) =>
              (where.userId === undefined || message.userId === where.userId) &&
              (where.fromAddress === undefined ||
                message.fromAddress === where.fromAddress) &&
              (where.templateFingerprint === undefined ||
                message.templateFingerprint === where.templateFingerprint),
          ),
        );
      },
    );
    prismaMock.aiEmailMessage.findFirst.mockImplementation(
      (command: { where: { id: string; userId: string } }) =>
        Promise.resolve(
          messages.find(
            (message) =>
              message.id === command.where.id &&
              message.userId === command.where.userId,
          ) ?? null,
        ),
    );
    prismaMock.aiDatasetItem.findMany.mockImplementation(
      (command: {
        where?: {
          datasetId?: string;
          userId?: string;
          sourceType?: string;
          sourceId?: { in?: string[] };
        };
      }) => {
        const where = command.where ?? {};
        const requested = where.sourceId?.in;
        return Promise.resolve(
          partitions.filter(
            (item) =>
              (where.datasetId === undefined ||
                item.datasetId === where.datasetId) &&
              (where.userId === undefined || item.userId === where.userId) &&
              (where.sourceType === undefined ||
                item.sourceType === where.sourceType) &&
              (!requested || requested.includes(item.sourceId)),
          ),
        );
      },
    );
    prismaMock.aiHumanVerification.findMany.mockImplementation(
      (command: {
        where?: {
          userId?: string;
          targetType?: string;
          targetId?: string | { in?: string[] };
        };
      }) => {
        const where = command.where ?? {};
        const requested =
          typeof where.targetId === 'string'
            ? [where.targetId]
            : where.targetId?.in;
        return Promise.resolve(
          verifications
            .filter(
              (verification) =>
                (where.userId === undefined ||
                  verification.userId === where.userId) &&
                (where.targetType === undefined ||
                  verification.targetType === where.targetType) &&
                (!requested || requested.includes(verification.targetId)),
            )
            .sort((left, right) => Number(left.sequence - right.sequence)),
        );
      },
    );
    prismaMock.aiHumanVerification.createMany.mockImplementation(
      ({ data: createdRows }: { data: StoredVerificationInput[] }) => {
        const offset = verifications.length;
        verifications.push(
          ...createdRows.map((row, index) => ({
            ...row,
            sequence: BigInt(offset + index + 1),
            createdAt: receivedAt,
          })),
        );
        return Promise.resolve({ count: createdRows.length });
      },
    );

    const moduleFixture = await applyAuthTestOverrides(
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

  const postBatch = (labels: Record<string, unknown>, expectedStatus = 201) =>
    request(app.getHttpServer())
      .post('/api/intelligence/review-groups/verifications')
      .set('Authorization', `Bearer ${token}`)
      .send({
        verdict: 'CONFIRMED',
        fromAddress: 'notifications@github.com',
        templateFingerprint: 'fp-github',
        ...labels,
      })
      .expect(expectedStatus);

  it('groups by sender and template and verifies only pending non-HOLDOUT mail', async () => {
    const groups = await request(app.getHttpServer())
      .get('/api/intelligence/review-groups')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(groups.body.data).toMatchObject({
      page: 1,
      pageSize: 20,
      totalGroups: 1,
      hasMore: false,
    });
    expect(groups.body.data.items[0]).toMatchObject({
      fromAddress: 'notifications@github.com',
      templateFingerprint: 'fp-github',
      total: 100,
      pending: 100,
      pendingHoldout: 9,
    });
    expect(groups.body.data.items[0].sampleSubjects).toHaveLength(3);
    expect(groups.body.data.items[0].sampleMessageIds).toHaveLength(3);
    expect(
      groups.body.data.items[0].sampleMessageIds.every(
        (id: unknown) => typeof id === 'string' && id.length > 0,
      ),
    ).toBe(true);
    expect(JSON.stringify(groups.body.data)).not.toContain('only-other');

    const batch = await postBatch({ relevance: true });
    expect(batch.body.data).toEqual({
      verified: 91,
      holdoutExcluded: 9,
      alreadyVerified: 0,
    });
    expect(verifications).toHaveLength(91);
    expect(
      verifications.every(
        ({ userId, verifierRole, verdict }) =>
          userId === 'user-123' &&
          verifierRole === 'ADMIN' &&
          verdict === 'CONFIRMED',
      ),
    ).toBe(true);
    expect(
      verifications.some(({ targetId }) => /^g(9[1-9])$/.test(targetId)),
    ).toBe(false);

    const repeated = await postBatch({ relevance: true });
    expect(repeated.body.data).toEqual({
      verified: 0,
      holdoutExcluded: 9,
      alreadyVerified: 91,
    });
    expect(verifications).toHaveLength(91);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);

    const after = await request(app.getHttpServer())
      .get('/api/intelligence/review-groups')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(after.body.data.items[0]).toMatchObject({
      total: 100,
      pending: 9,
      pendingHoldout: 9,
    });
  });

  it('shows the batch verification with role and sequence in the message detail', async () => {
    await postBatch({ relevance: true });

    const detail = await request(app.getHttpServer())
      .get('/api/intelligence/messages/g0')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(detail.body.data.provenance.verifications).toEqual([
      expect.objectContaining({
        sequence: '1',
        verifierRole: 'ADMIN',
        verdict: 'CONFIRMED',
        isGroundTruth: false,
      }),
    ]);
  });

  it.each([
    { semanticType: 'NOT_A_TYPE' },
    { routes: ['TRAVEL'] },
    { verdict: 'REJECTED' },
    { fromAddress: '' },
    { semanticType: 'OTHER' },
    { semanticType: 'FIN_TRANSACTION' },
  ])('rejects an invalid batch %# and records nothing', async (labels) => {
    await postBatch(labels, 400);
    expect(verifications).toHaveLength(0);
  });

  it('does not list or verify another account group', async () => {
    const groups = await request(app.getHttpServer())
      .get('/api/intelligence/review-groups')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(
      groups.body.data.items.map(
        ({ fromAddress }: { fromAddress: string }) => fromAddress,
      ),
    ).toEqual(['notifications@github.com']);

    await postBatch(
      {
        fromAddress: 'only-other@example.com',
        templateFingerprint: 'fp-other',
      },
      404,
    );
    expect(verifications).toHaveLength(0);
  });

  it('rejects an invalid page size', async () => {
    await request(app.getHttpServer())
      .get('/api/intelligence/review-groups?pageSize=101')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });
});
