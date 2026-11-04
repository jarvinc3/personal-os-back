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
            fromAddress?: string;
            templateFingerprint?: string | null;
          };
        }) =>
          Promise.resolve(
            messages.filter(
              (message) =>
                (command.where.userId === undefined ||
                  message.userId === command.where.userId) &&
                (command.where.fromAddress === undefined ||
                  message.fromAddress === command.where.fromAddress) &&
                (command.where.templateFingerprint === undefined ||
                  message.templateFingerprint ===
                    command.where.templateFingerprint),
            ),
          ),
      ),
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
    $queryRaw: jest.fn().mockResolvedValue([]),
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
    const service = new AiEvidenceService(prisma as never);

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

  it('verifies every pending non-HOLDOUT message of the group once', async () => {
    const { prisma, verifications } = makeReviewGroupPrisma({
      messages: githubMessages(),
      partitions: githubPartitions(),
    });
    const service = new AiEvidenceService(prisma as never);
    const request = {
      verdict: 'CONFIRMED' as const,
      fromAddress: 'notifications@github.com',
      templateFingerprint: 'fp-github',
      relevance: true,
    };

    await expect(service.verifyReviewGroup('user-1', request)).resolves.toEqual(
      { verified: 91, holdoutExcluded: 9, alreadyVerified: 0 },
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
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.aiHumanVerification.findMany.mock.invocationCallOrder[0],
    );

    await expect(service.verifyReviewGroup('user-1', request)).resolves.toEqual(
      { verified: 0, holdoutExcluded: 9, alreadyVerified: 91 },
    );
    expect(prisma.aiHumanVerification.createMany).toHaveBeenCalledTimes(1);
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
    const service = new AiEvidenceService(prisma as never);

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
    const service = new AiEvidenceService(prisma as never);

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
    const service = new AiEvidenceService(prisma as never);

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
    const service = new AiEvidenceService(prisma as never);

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
});
