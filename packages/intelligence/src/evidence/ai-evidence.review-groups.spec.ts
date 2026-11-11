import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AiEvidenceService } from './ai-evidence.service';
import type { EmailDatasetPartition } from './dataset-partition.util';

type StoredMessage = {
  id: string;
  userId: string;
  fromAddress: string;
  subject: string;
  templateFingerprint: string | null;
  receivedAt: Date;
  classification?: unknown;
};

type StoredPartition = {
  sourceId: string;
  partition: EmailDatasetPartition;
};

type StoredVerification = {
  userId: string;
  targetType: string;
  targetId: string;
  verifierRole: string;
  verdict: string;
  correctedPayload?: unknown;
  notes: string | null;
  isGroundTruth: boolean;
};

const REVIEW_TARGET_TYPE = 'EMAIL_MESSAGE';

const reclassification = {
  reclassifyAfterMessageVerification: jest
    .fn()
    .mockResolvedValue({ requeued: 0 }),
  reclassifyAfterReviewGroupVerification: jest
    .fn()
    .mockResolvedValue({ requeued: 0 }),
};

const githubMessages = (): StoredMessage[] =>
  Array.from({ length: 100 }, (_, index) => ({
    id: `g${index}`,
    userId: 'user-1',
    fromAddress: 'notifications@github.com',
    subject: index < 3 ? `Aviso ${index + 1}` : 'Aviso',
    templateFingerprint: 'fp-github',
    receivedAt: new Date(Date.UTC(2026, 9, 1, 0, index)),
  }));

const githubPartitions = (): StoredPartition[] =>
  Array.from({ length: 100 }, (_, index) => ({
    sourceId: `g${index}`,
    partition: index < 91 ? 'TRAIN' : 'HOLDOUT',
  }));

function makeReviewGroupPrisma({
  messages,
  partitions,
  initialVerifications = [],
}: {
  messages: StoredMessage[];
  partitions: StoredPartition[];
  initialVerifications?: StoredVerification[];
}) {
  const verifications: StoredVerification[] = [...initialVerifications];
  const prisma = {
    aiDataset: {
      upsert: jest
        .fn()
        .mockResolvedValue({ id: 'dataset-1', name: 'EMAIL_V1' }),
    },
    aiDatasetItem: {
      findMany: jest.fn(
        (command: { where: { sourceId?: { in?: string[] } } }) => {
          const requested = command.where.sourceId?.in;
          return Promise.resolve(
            partitions.filter(
              ({ sourceId }) => !requested || requested.includes(sourceId),
            ),
          );
        },
      ),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    aiEmailMessage: {
      findMany: jest.fn(
        (command: {
          where: {
            userId?: string;
            id?: string | { in?: string[] };
            fromAddress?: string;
            templateFingerprint?: string | null;
          };
        }) =>
          Promise.resolve(
            messages.filter(
              (message) =>
                (command.where.userId === undefined ||
                  message.userId === command.where.userId) &&
                (command.where.id === undefined ||
                  (typeof command.where.id === 'string'
                    ? message.id === command.where.id
                    : (command.where.id.in?.includes(message.id) ?? true))) &&
                (command.where.fromAddress === undefined ||
                  message.fromAddress === command.where.fromAddress) &&
                (command.where.templateFingerprint === undefined ||
                  message.templateFingerprint ===
                    command.where.templateFingerprint),
            ),
          ),
      ),
    },
    aiKnowledge: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    aiHumanVerification: {
      findMany: jest.fn(
        (command: {
          where: {
            userId: string;
            targetType: string;
            targetId?: { in?: string[] };
          };
        }) => {
          const requested = command.where.targetId?.in;
          return Promise.resolve(
            verifications.filter(
              (verification) =>
                verification.userId === command.where.userId &&
                verification.targetType === command.where.targetType &&
                (!requested || requested.includes(verification.targetId)),
            ),
          );
        },
      ),
      createMany: jest.fn(
        ({ data: createdRows }: { data: StoredVerification[] }) => {
          verifications.push(...createdRows);
          return Promise.resolve({ count: createdRows.length });
        },
      ),
    },
    userRole: {
      findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }),
    },
    $executeRaw: jest.fn().mockResolvedValue(0),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((callback: (tx: unknown) => unknown) =>
    callback(prisma),
  );
  return { prisma, verifications };
}

describe('AiEvidenceService review groups', () => {
  it('lists pending groups ordered by pending messages with pagination', async () => {
    const messages: StoredMessage[] = [
      ...githubMessages(),
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `n${index}`,
        userId: 'user-1',
        fromAddress: 'news@example.com',
        subject: 'Boletín',
        templateFingerprint: 'fp-news',
        receivedAt: new Date(Date.UTC(2026, 8, 1, 0, index)),
      })),
      {
        id: 'o1',
        userId: 'user-1',
        fromAddress: 'old@example.com',
        subject: 'Viejo',
        templateFingerprint: 'fp-old',
        receivedAt: new Date(Date.UTC(2026, 7, 1)),
      },
    ];
    const partitions: StoredPartition[] = [
      ...githubPartitions(),
      ...Array.from({ length: 5 }, (_, index) => ({
        sourceId: `n${index}`,
        partition: 'TRAIN' as const,
      })),
      { sourceId: 'o1', partition: 'TRAIN' },
    ];
    const initialVerifications: StoredVerification[] = ['n3', 'n4', 'o1'].map(
      (targetId) => ({
        userId: 'user-1',
        targetType: REVIEW_TARGET_TYPE,
        targetId,
        verifierRole: 'USER',
        verdict: 'CONFIRMED',
        notes: null,
        isGroundTruth: false,
      }),
    );
    const { prisma } = makeReviewGroupPrisma({
      messages,
      partitions,
      initialVerifications,
    });
    const service = new AiEvidenceService(
      prisma as never,
      reclassification as never,
    );

    const firstPage = await service.listReviewGroups('user-1', {});
    expect(firstPage).toMatchObject({
      page: 1,
      totalGroups: 2,
      hasMore: false,
    });
    expect(firstPage.items).toEqual([
      {
        fromAddress: 'notifications@github.com',
        templateFingerprint: 'fp-github',
        total: 100,
        pending: 100,
        pendingHoldout: 9,
        sampleSubjects: ['Aviso 1', 'Aviso 2', 'Aviso 3'],
        sampleMessageIds: ['g0', 'g1', 'g2'],
      },
      {
        fromAddress: 'news@example.com',
        templateFingerprint: 'fp-news',
        total: 5,
        pending: 3,
        pendingHoldout: 0,
        sampleSubjects: ['Boletín'],
        sampleMessageIds: ['n0'],
      },
    ]);

    const secondPage = await service.listReviewGroups('user-1', {
      page: 2,
      pageSize: 1,
    });
    expect(secondPage).toMatchObject({ page: 2, pageSize: 1, totalGroups: 2 });
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0].fromAddress).toBe('news@example.com');
    expect(secondPage.hasMore).toBe(false);

    const beyond = await service.listReviewGroups('user-1', {
      page: 5,
      pageSize: 20,
    });
    expect(beyond.items).toEqual([]);
    expect(beyond.totalGroups).toBe(2);
  });

  it('uses impact order by pending count, unknown sender, then lower mean confidence', async () => {
    const messages: StoredMessage[] = [
      ...Array.from({ length: 3 }, (_, index) => ({
        id: `large-${index}`,
        userId: 'user-1',
        fromAddress: 'large@bank.com',
        subject: `Large ${index}`,
        templateFingerprint: 'large',
        receivedAt: new Date(Date.UTC(2026, 9, 1, 0, index)),
        classification: { confidence: 0.9 },
      })),
      ...[
        ['new-low', 'new-low@bank.com', 0.2],
        ['new-low-2', 'new-low@bank.com', 0.2],
        ['new-high', 'new-high@bank.com', 0.8],
        ['new-high-2', 'new-high@bank.com', 0.8],
        ['known-low', 'known-low@bank.com', 0.1],
        ['known-low-2', 'known-low@bank.com', 0.1],
      ].map(([id, fromAddress, confidence], index) => ({
        id,
        userId: 'user-1',
        fromAddress,
        subject: id,
        templateFingerprint: id.startsWith('known')
          ? 'known-low'
          : id.startsWith('new-low')
            ? 'new-low'
            : 'new-high',
        receivedAt: new Date(Date.UTC(2026, 9, 1, 1, index)),
        classification: { confidence: Number(confidence) },
      })),
    ];
    const partitions = messages.map(({ id }) => ({
      sourceId: id,
      partition: 'TRAIN' as const,
    }));
    const { prisma } = makeReviewGroupPrisma({ messages, partitions });
    prisma.aiKnowledge.findMany.mockResolvedValue([
      { knowledgeKey: 'large@bank.com' },
      { knowledgeKey: 'known-low@bank.com' },
    ]);
    const service = new AiEvidenceService(
      prisma as never,
      reclassification as never,
    );

    const result = await service.listReviewGroups('user-1', {});

    expect(result.items.map(({ fromAddress }) => fromAddress)).toEqual([
      'large@bank.com',
      'new-low@bank.com',
      'new-high@bank.com',
      'known-low@bank.com',
    ]);
  });

  it('verifies every pending non-HOLDOUT message of the group once', async () => {
    const { prisma, verifications } = makeReviewGroupPrisma({
      messages: githubMessages(),
      partitions: githubPartitions(),
    });
    const service = new AiEvidenceService(
      prisma as never,
      reclassification as never,
    );
    const request = {
      verdict: 'CONFIRMED' as const,
      fromAddress: 'notifications@github.com',
      templateFingerprint: 'fp-github',
      relevance: true,
    };

    await expect(service.verifyReviewGroup('user-1', request)).resolves.toEqual(
      { verified: 91, holdoutExcluded: 9, alreadyVerified: 0, requeued: 0 },
    );
    expect(prisma.aiHumanVerification.createMany).toHaveBeenCalledTimes(1);
    expect(verifications).toHaveLength(91);
    expect(verifications[0]).toEqual({
      userId: 'user-1',
      verifierRole: 'ADMIN',
      targetType: REVIEW_TARGET_TYPE,
      targetId: 'g0',
      verdict: 'CONFIRMED',
      correctedPayload: { relevance: true },
      notes: null,
      isGroundTruth: false,
    });
    expect(verifications.map(({ targetId }) => targetId)).not.toContain('g91');
    expect(prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.aiHumanVerification.findMany.mock.invocationCallOrder[0],
    );

    await expect(service.verifyReviewGroup('user-1', request)).resolves.toEqual(
      { verified: 0, holdoutExcluded: 9, alreadyVerified: 91, requeued: 0 },
    );
    expect(prisma.aiHumanVerification.createMany).toHaveBeenCalledTimes(1);
  });

  it('verifies a selected set in one transaction and remains idempotent', async () => {
    const { prisma, verifications } = makeReviewGroupPrisma({
      messages: githubMessages(),
      partitions: githubPartitions(),
    });
    const service = new AiEvidenceService(
      prisma as never,
      reclassification as never,
    );
    const request = {
      messageIds: Array.from({ length: 20 }, (_, index) => `g${index}`),
      verdict: 'CONFIRMED' as const,
      relevance: true,
    };

    await expect(
      service.verifyReviewSelection('user-1', request),
    ).resolves.toEqual({ verified: 20, alreadyVerified: 0, requeued: 0 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.aiHumanVerification.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.aiHumanVerification.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ targetId: 'g0', isGroundTruth: false }),
        expect.objectContaining({ targetId: 'g1', isGroundTruth: false }),
      ]),
    });
    expect(verifications).toHaveLength(20);
    expect(verifications.map(({ targetId }) => targetId)).toEqual(
      request.messageIds,
    );

    await expect(
      service.verifyReviewSelection('user-1', request),
    ).resolves.toEqual({ verified: 0, alreadyVerified: 20, requeued: 0 });
    expect(prisma.aiHumanVerification.createMany).toHaveBeenCalledTimes(1);
  });

  it('rejects a selection above the twenty-message contract limit', async () => {
    const { prisma } = makeReviewGroupPrisma({
      messages: githubMessages(),
      partitions: githubPartitions(),
    });
    const service = new AiEvidenceService(
      prisma as never,
      reclassification as never,
    );

    await expect(
      service.verifyReviewSelection('user-1', {
        messageIds: Array.from({ length: 21 }, (_, index) => `g${index}`),
        verdict: 'CONFIRMED',
        relevance: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.aiEmailMessage.findMany).not.toHaveBeenCalled();
  });

  it('rejects a selection containing a message outside the account without partial writes', async () => {
    const { prisma, verifications } = makeReviewGroupPrisma({
      messages: githubMessages(),
      partitions: githubPartitions(),
    });
    const service = new AiEvidenceService(
      prisma as never,
      reclassification as never,
    );

    await expect(
      service.verifyReviewSelection('user-1', {
        messageIds: ['g0', 'missing'],
        verdict: 'CONFIRMED',
        relevance: true,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.aiHumanVerification.createMany).not.toHaveBeenCalled();
    expect(verifications).toHaveLength(0);
  });

  it('records a selected HOLDOUT message as ground truth', async () => {
    const { prisma, verifications } = makeReviewGroupPrisma({
      messages: githubMessages(),
      partitions: githubPartitions(),
    });
    const service = new AiEvidenceService(
      prisma as never,
      reclassification as never,
    );

    await expect(
      service.verifyReviewSelection('user-1', {
        messageIds: ['g91'],
        verdict: 'CONFIRMED',
        relevance: true,
      }),
    ).resolves.toMatchObject({ verified: 1, alreadyVerified: 0 });

    expect(verifications).toMatchObject([
      { targetId: 'g91', isGroundTruth: true, verdict: 'CONFIRMED' },
    ]);
  });

  it('counts an already verified HOLDOUT message as already verified', async () => {
    const initialVerifications: StoredVerification[] = [
      {
        userId: 'user-1',
        targetType: REVIEW_TARGET_TYPE,
        targetId: 'g99',
        verifierRole: 'USER',
        verdict: 'CONFIRMED',
        notes: null,
        isGroundTruth: true,
      },
    ];
    const { prisma, verifications } = makeReviewGroupPrisma({
      messages: githubMessages(),
      partitions: githubPartitions(),
      initialVerifications,
    });
    const service = new AiEvidenceService(
      prisma as never,
      reclassification as never,
    );

    await expect(
      service.verifyReviewGroup('user-1', {
        verdict: 'CORRECTED',
        fromAddress: 'notifications@github.com',
        templateFingerprint: 'fp-github',
        semanticType: 'OTHER',
        notes: '  plantilla conocida  ',
      }),
    ).resolves.toEqual({
      verified: 91,
      holdoutExcluded: 8,
      alreadyVerified: 1,
      requeued: 0,
    });
    const createdVerifications = verifications.slice(1);
    expect(createdVerifications[0]).toMatchObject({
      correctedPayload: { semanticType: 'OTHER' },
      notes: 'plantilla conocida',
    });
  });

  it('does not expose or verify another account group', async () => {
    const { prisma } = makeReviewGroupPrisma({
      messages: githubMessages().map((message) => ({
        ...message,
        userId: 'other-user',
      })),
      partitions: githubPartitions(),
    });
    const service = new AiEvidenceService(
      prisma as never,
      reclassification as never,
    );

    await expect(
      service.verifyReviewGroup('user-1', {
        verdict: 'CONFIRMED',
        fromAddress: 'notifications@github.com',
        templateFingerprint: 'fp-github',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.aiHumanVerification.createMany).not.toHaveBeenCalled();

    expect((await service.listReviewGroups('user-1', {})).items).toEqual([]);
  });

  it('rejects an unknown template of an existing sender', async () => {
    const { prisma } = makeReviewGroupPrisma({
      messages: githubMessages(),
      partitions: githubPartitions(),
    });
    const service = new AiEvidenceService(
      prisma as never,
      reclassification as never,
    );

    await expect(
      service.verifyReviewGroup('user-1', {
        verdict: 'CONFIRMED',
        fromAddress: 'notifications@github.com',
        templateFingerprint: 'unknown',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.aiHumanVerification.createMany).not.toHaveBeenCalled();
  });

  it('rejects inconsistent labels before reading the group', async () => {
    const { prisma } = makeReviewGroupPrisma({
      messages: githubMessages(),
      partitions: githubPartitions(),
    });
    const service = new AiEvidenceService(
      prisma as never,
      reclassification as never,
    );

    await expect(
      service.verifyReviewGroup('user-1', {
        verdict: 'CORRECTED',
        fromAddress: 'notifications@github.com',
        templateFingerprint: 'fp-github',
        semanticType: 'OTHER',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.verifyReviewGroup('user-1', {
        verdict: 'CORRECTED',
        fromAddress: 'notifications@github.com',
        templateFingerprint: 'fp-github',
        semanticType: 'FIN_TRANSACTION',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.aiEmailMessage.findMany).not.toHaveBeenCalled();
    expect(prisma.aiHumanVerification.createMany).not.toHaveBeenCalled();
  });

  it('reencola el resto del remitente con la etiqueta corregida del lote', async () => {
    const { prisma } = makeReviewGroupPrisma({
      messages: githubMessages(),
      partitions: githubPartitions(),
    });
    reclassification.reclassifyAfterReviewGroupVerification.mockResolvedValueOnce(
      { requeued: 12 },
    );
    const service = new AiEvidenceService(
      prisma as never,
      reclassification as never,
    );

    await expect(
      service.verifyReviewGroup('user-1', {
        verdict: 'CORRECTED',
        fromAddress: 'notifications@github.com',
        templateFingerprint: 'fp-github',
        relevance: true,
        semanticType: 'FIN_TRANSACTION',
        routes: ['FINANCE'],
        transaction: { kind: 'TRANSACTION' },
      }),
    ).resolves.toMatchObject({ requeued: 12 });
    expect(
      reclassification.reclassifyAfterReviewGroupVerification,
    ).toHaveBeenCalledWith({
      userId: 'user-1',
      fromAddress: 'notifications@github.com',
      templateFingerprint: 'fp-github',
      correctedLabel: {
        relevance: true,
        semanticType: 'FIN_TRANSACTION',
        routes: ['FINANCE'],
        transaction: { kind: 'TRANSACTION' },
      },
    });
  });
});
