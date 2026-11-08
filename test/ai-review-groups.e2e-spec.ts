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

type ReviewMessage = {
  id: string;
  userId: string;
  fromAddress: string;
  fromDomain: string;
  subject: string;
  templateFingerprint: string | null;
  receivedAt: Date;
  processingStatus?: string;
  classification?: Record<string, unknown> | null;
  classificationStartedAt?: Date | null;
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

function financeClassification(amount: number) {
  return {
    relevance: true,
    semanticType: 'FIN_TRANSACTION',
    routes: ['FINANCE'],
    transaction: {
      kind: 'TRANSACTION',
      amount,
      currency: 'DOP',
      last4: '4821',
    },
    confidence: 0.4,
  };
}

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
  let applyMessageUpdate: (command: {
    where: Record<string, any>;
    data: Record<string, any>;
  }) => Promise<{ count: number }>;
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

    const matchesMessage = (where: Record<string, any>) => {
      const statusFilter = where.processingStatus as
        string | { in?: string[] } | undefined;
      const statuses =
        typeof statusFilter === 'string' ? [statusFilter] : statusFilter?.in;
      const idFilter = where.id as string | { in?: string[] } | undefined;
      const ids = typeof idFilter === 'string' ? [idFilter] : idFilter?.in;
      return (message: ReviewMessage) =>
        (where.userId === undefined || message.userId === where.userId) &&
        (where.fromAddress === undefined ||
          message.fromAddress === where.fromAddress) &&
        (where.fromDomain === undefined ||
          message.fromDomain === where.fromDomain) &&
        (where.templateFingerprint === undefined ||
          message.templateFingerprint === where.templateFingerprint) &&
        (!ids || ids.includes(message.id)) &&
        (!statuses ||
          (message.processingStatus !== undefined &&
            statuses.includes(message.processingStatus))) &&
        (where.classificationStartedAt === undefined ||
          message.classificationStartedAt === where.classificationStartedAt);
    };
    prismaMock.aiEmailMessage.findMany.mockImplementation(
      (command: { where?: Record<string, any> }) => {
        const where = command.where ?? {};
        return Promise.resolve(messages.filter(matchesMessage(where)));
      },
    );
    applyMessageUpdate = (command) => {
      const matched = messages.filter(matchesMessage(command.where));
      for (const message of matched) {
        Object.assign(message, command.data);
      }
      return Promise.resolve({ count: matched.length });
    };
    prismaMock.aiEmailMessage.updateMany.mockImplementation(applyMessageUpdate);
    prismaMock.aiEmailMessage.updateManyAndReturn.mockImplementation(
      (command: { where: Record<string, any>; data: Record<string, any> }) => {
        const matched = messages.filter(matchesMessage(command.where));
        for (const message of matched) {
          Object.assign(message, command.data);
        }
        return Promise.resolve(matched.map((message) => ({ ...message })));
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
    prismaMock.aiDatasetItem.findFirst.mockImplementation(
      (command: { where: { userId: string; sourceId: string } }) =>
        Promise.resolve(
          partitions.find(
            (item) =>
              item.userId === command.where.userId &&
              item.sourceId === command.where.sourceId,
          ) ?? null,
        ),
    );
    prismaMock.aiHumanVerification.findFirst.mockImplementation(
      (command: {
        where: { userId: string; targetType: string; targetId: string };
      }) =>
        Promise.resolve(
          [...verifications]
            .filter(
              (verification) =>
                verification.userId === command.where.userId &&
                verification.targetType === command.where.targetType &&
                verification.targetId === command.where.targetId,
            )
            .sort((left, right) => Number(right.sequence - left.sequence))[0] ??
            null,
        ),
    );
    prismaMock.aiHumanVerification.create.mockImplementation(
      ({ data: created }: { data: StoredVerificationInput }) => {
        const row = {
          ...created,
          sequence: BigInt(verifications.length + 1),
          createdAt: receivedAt,
        };
        verifications.push(row);
        return Promise.resolve(row);
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
      requeued: 0,
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
      requeued: 0,
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

  it('no generaliza la verificación del lote a otras plantillas del remitente', async () => {
    const extras: ReviewMessage[] = ['x1', 'x2'].map((id, index) => ({
      id,
      userId: 'user-123',
      fromAddress: 'notifications@github.com',
      fromDomain: 'github.com',
      subject: 'Pago recibido',
      templateFingerprint: 'fp-other',
      receivedAt,
      processingStatus: 'REVIEW_REQUIRED',
      classification: financeClassification(index === 0 ? 1250 : 3400),
    }));
    messages = [...githubMessages, ...extras];
    partitions = [
      ...githubMessages.map((message, index) =>
        partition(message, index >= 91 ? 'HOLDOUT' : 'TRAIN'),
      ),
      ...extras.map((message) => partition(message, 'TRAIN')),
    ];

    const batch = await postBatch({
      relevance: true,
      semanticType: 'FIN_TRANSACTION',
      routes: ['FINANCE'],
      transaction: { kind: 'TRANSACTION' },
    });

    expect(batch.body.data).toMatchObject({
      verified: 91,
      holdoutExcluded: 9,
      requeued: 0,
    });
    expect(extras.map(({ processingStatus }) => processingStatus)).toEqual([
      'REVIEW_REQUIRED',
      'REVIEW_REQUIRED',
    ]);
    expect(prismaMock.aiSignal.createMany).not.toHaveBeenCalled();
  });

  it('reclasifica solo la misma plantilla al verificar un mensaje', async () => {
    const verifiedMessage: ReviewMessage = {
      id: 't0',
      userId: 'user-123',
      fromAddress: 'alertas@banco.com',
      fromDomain: 'banco.com',
      subject: 'Consumo RD$1,250',
      templateFingerprint: 'fp-a',
      receivedAt,
      processingStatus: 'PROCESSED',
      classification: financeClassification(999),
    };
    const sameTemplate: ReviewMessage = {
      ...verifiedMessage,
      id: 't1',
      subject: 'Consumo RD$3,400',
      processingStatus: 'REVIEW_REQUIRED',
      classification: financeClassification(3400),
    };
    const otherTemplate: ReviewMessage = {
      ...verifiedMessage,
      id: 't2',
      subject: 'Estado de cuenta',
      templateFingerprint: 'fp-b',
      processingStatus: 'REVIEW_REQUIRED',
      classification: financeClassification(5000),
    };
    messages = [verifiedMessage, sameTemplate, otherTemplate];
    partitions = messages.map((message) => partition(message, 'TRAIN'));

    const response = await request(app.getHttpServer())
      .post('/api/intelligence/messages/t0/verifications')
      .set('Authorization', `Bearer ${token}`)
      .send({
        verdict: 'CORRECTED',
        relevance: true,
        semanticType: 'FIN_TRANSACTION',
        routes: ['FINANCE'],
        transaction: { kind: 'TRANSACTION' },
      })
      .expect(201);

    expect(response.body.data).toMatchObject({ requeued: 1 });
    expect(sameTemplate.processingStatus).toBe('PROCESSED');
    expect(sameTemplate.classification).toMatchObject({
      semanticType: 'FIN_TRANSACTION',
      transaction: { amount: 3400, currency: 'DOP' },
    });
    expect(otherTemplate.processingStatus).toBe('REVIEW_REQUIRED');
    expect(prismaMock.aiSignal.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ id: 'email-t1', sourceId: 't1' })],
      }),
    );
  });

  it('reintenta la reclasificación sin duplicar la verificación', async () => {
    const verifiedMessage: ReviewMessage = {
      id: 'r0',
      userId: 'user-123',
      fromAddress: 'alertas@banco.com',
      fromDomain: 'banco.com',
      subject: 'Consumo RD$1,250',
      templateFingerprint: 'fp-r',
      receivedAt,
      processingStatus: 'PROCESSED',
      classification: financeClassification(999),
    };
    const sameTemplate: ReviewMessage = {
      ...verifiedMessage,
      id: 'r1',
      subject: 'Consumo RD$3,400',
      processingStatus: 'REVIEW_REQUIRED',
      classification: financeClassification(3400),
    };
    messages = [verifiedMessage, sameTemplate];
    partitions = messages.map((message) => partition(message, 'TRAIN'));
    prismaMock.aiEmailMessage.updateMany.mockRejectedValueOnce(
      new Error('chunk write failed'),
    );

    const body = {
      verdict: 'CORRECTED',
      relevance: true,
      semanticType: 'FIN_TRANSACTION',
      routes: ['FINANCE'],
      transaction: { kind: 'TRANSACTION' },
    };
    await request(app.getHttpServer())
      .post('/api/intelligence/messages/r0/verifications')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(500);

    expect(verifications).toHaveLength(1);
    expect(sameTemplate.processingStatus).toBe('REVIEW_REQUIRED');

    const retried = await request(app.getHttpServer())
      .post('/api/intelligence/messages/r0/verifications')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(201);

    expect(retried.body.data).toMatchObject({ requeued: 1 });
    expect(verifications).toHaveLength(1);
    expect(sameTemplate.processingStatus).toBe('PROCESSED');
  });
});
