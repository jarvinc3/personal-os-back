import { BadRequestException } from '@nestjs/common';
import { decodeCursor } from '@personal-os/core';
import { AiEvidenceService } from './ai-evidence.service';

const reclassification = {
  reclassifyAfterMessageVerification: jest
    .fn()
    .mockResolvedValue({ requeued: 0 }),
  reclassifyAfterReviewGroupVerification: jest
    .fn()
    .mockResolvedValue({ requeued: 0 }),
};

type StoredMessage = {
  id: string;
  userId: string;
  receivedAt: Date;
  fromAddress: string;
  fromDomain: string;
  subject: string;
  contentFingerprint: string;
  processingStatus: string;
  classification?: unknown;
};

type StoredItem = {
  datasetId: string;
  userId: string;
  sourceType: string;
  sourceId: string;
  partition: 'TRAIN' | 'VALIDATION' | 'HOLDOUT';
};

type StoredVerification = {
  userId: string;
  targetType: string;
  targetId: string;
  sequence: bigint;
  verdict: 'CONFIRMED' | 'CORRECTED' | 'REJECTED';
  correctedPayload: unknown;
  notes: string | null;
  createdAt: Date;
};

const message = ({
  id,
  receivedAt,
}: {
  id: string;
  receivedAt: string;
}): StoredMessage => ({
  id,
  userId: 'user-1',
  receivedAt: new Date(receivedAt),
  fromAddress: 'notifications@github.com',
  fromDomain: 'github.com',
  subject: `Aviso ${id}`,
  contentFingerprint: `fingerprint-${id}`,
  processingStatus: 'INGESTED',
});

const item = (
  sourceId: string,
  partition: StoredItem['partition'],
): StoredItem => ({
  datasetId: 'dataset-1',
  userId: 'user-1',
  sourceType: 'EMAIL_MESSAGE',
  sourceId,
  partition,
});

const verification = ({
  targetId,
  sequence,
  verdict,
  overrides = {},
}: {
  targetId: string;
  sequence: bigint;
  verdict: StoredVerification['verdict'];
  overrides?: Partial<StoredVerification>;
}): StoredVerification => ({
  userId: 'user-1',
  targetType: 'EMAIL_MESSAGE',
  targetId,
  sequence,
  verdict,
  correctedPayload: null,
  notes: null,
  createdAt: new Date('2026-10-25T12:00:00.000Z'),
  ...overrides,
});

function makePrisma({
  items,
  verifications,
}: {
  items: StoredItem[];
  verifications: StoredVerification[];
}) {
  const prisma = {
    aiDataset: {
      upsert: jest
        .fn()
        .mockResolvedValue({ id: 'dataset-1', name: 'EMAIL_V1' }),
    },
    aiDatasetItem: {
      findMany: jest.fn(
        (command: { where: { sourceId?: { in?: string[] } } }) => {
          const requested = command.where?.sourceId?.in;
          return Promise.resolve(
            items.filter(
              ({ sourceId }) => !requested || requested.includes(sourceId),
            ),
          );
        },
      ),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    aiEmailMessage: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    aiHumanVerification: {
      findMany: jest.fn().mockResolvedValue(verifications),
    },
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ timezone: 'America/Santo_Domingo' }),
    },
    aiKnowledge: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  return prisma;
}

function mockMessageQueries(
  prisma: ReturnType<typeof makePrisma>,
  pageMessages: StoredMessage[],
  matchingMessageIds?: string[],
  resolvedMessageIds: string[] = [],
) {
  const responses: Array<Array<{ id: string }>> = [
    [{ id: 'dataset-message' }],
    resolvedMessageIds.map((id) => ({ id })),
  ];
  if (matchingMessageIds) {
    responses.push(matchingMessageIds.map((id) => ({ id })));
  }
  responses.push(pageMessages);
  for (const response of responses) {
    prisma.aiEmailMessage.findMany.mockResolvedValueOnce(response);
  }
}

describe('AiEvidenceService review queue filters', () => {
  it('lists pending messages with a derived status and the current counts', async () => {
    const pending = message({
      id: 'message-1',
      receivedAt: '2026-10-25T12:00:00.000Z',
    });
    const prisma = makePrisma({
      items: [
        item('message-1', 'TRAIN'),
        item('message-2', 'HOLDOUT'),
        item('message-3', 'HOLDOUT'),
      ],
      verifications: [],
    });
    mockMessageQueries(prisma, [pending]);
    const service = new AiEvidenceService(prisma, reclassification as never);

    const page = await service.reviewQueue('user-1');

    expect(page.items).toEqual([
      expect.objectContaining({
        id: 'message-1',
        partition: 'TRAIN',
        status: 'PENDING',
        verification: null,
      }),
    ]);
    expect(page.counts).toEqual({
      TRAIN: 1,
      VALIDATION: 0,
      HOLDOUT: 2,
      all: 3,
    });
    expect(prisma.aiEmailMessage.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-1',
          AND: [{ processingStatus: { notIn: ['PROCESSED', 'DISCARDED'] } }],
        },
        orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
        take: 51,
      }),
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('filters by the last verification, sender, subject, dates, partition and order', async () => {
    const first = message({
      id: 'message-1',
      receivedAt: '2026-10-25T12:00:00.000Z',
    });
    const prisma = makePrisma({
      items: [item('message-1', 'TRAIN'), item('message-2', 'HOLDOUT')],
      verifications: [
        verification({
          targetId: 'message-1',
          sequence: 1n,
          verdict: 'CONFIRMED',
        }),
        verification({
          targetId: 'message-1',
          sequence: 2n,
          verdict: 'CORRECTED',
          overrides: {
            correctedPayload: {
              relevance: true,
              semanticType: 'TECH_NOTIFICATION',
              routes: [],
            },
            notes: 'Corregido por el dueño',
          },
        }),
        verification({
          targetId: 'message-2',
          sequence: 1n,
          verdict: 'REJECTED',
          overrides: { notes: 'Publicidad' },
        }),
      ],
    });
    mockMessageQueries(prisma, [first], ['message-1']);
    const service = new AiEvidenceService(prisma, reclassification as never);

    const page = await service.reviewQueue('user-1', {
      status: ['CORRECTED'],
      partition: 'TRAIN',
      fromAddress: 'notifications@github.com',
      subject: 'Aviso',
      dateFrom: '2026-10-01',
      dateTo: '2026-10-31',
      order: 'NEWEST',
    });

    expect(prisma.aiEmailMessage.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-1',
          id: { in: ['message-1'] },
          fromAddress: {
            equals: 'notifications@github.com',
            mode: 'insensitive',
          },
          subject: { contains: 'Aviso', mode: 'insensitive' },
          receivedAt: {
            gte: new Date('2026-10-01T04:00:00.000Z'),
            lt: new Date('2026-11-01T04:00:00.000Z'),
          },
          AND: [{ id: { in: ['message-1'] } }],
        },
        orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      }),
    );
    expect(prisma.aiHumanVerification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', targetType: 'EMAIL_MESSAGE' },
        orderBy: [{ targetId: 'asc' }, { sequence: 'desc' }],
        distinct: ['targetId'],
      }),
    );
    expect(prisma.aiEmailMessage.findMany).toHaveBeenNthCalledWith(3, {
      where: {
        userId: 'user-1',
        fromAddress: {
          equals: 'notifications@github.com',
          mode: 'insensitive',
        },
        subject: { contains: 'Aviso', mode: 'insensitive' },
        receivedAt: {
          gte: new Date('2026-10-01T04:00:00.000Z'),
          lt: new Date('2026-11-01T04:00:00.000Z'),
        },
      },
      select: { id: true },
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { timezone: true },
    });
    expect(page.items).toEqual([
      expect.objectContaining({
        id: 'message-1',
        partition: 'TRAIN',
        status: 'CORRECTED',
        verification: {
          verdict: 'CORRECTED',
          labels: {
            relevance: true,
            semanticType: 'TECH_NOTIFICATION',
            routes: [],
          },
          notes: 'Corregido por el dueño',
          createdAt: '2026-10-25T12:00:00.000Z',
        },
      }),
    ]);
    expect(page.counts).toEqual({
      TRAIN: 0,
      VALIDATION: 0,
      HOLDOUT: 0,
      all: 0,
    });
  });

  it('counts only the pending messages that pass the search filters', async () => {
    const first = message({
      id: 'message-1',
      receivedAt: '2026-10-25T12:00:00.000Z',
    });
    const prisma = makePrisma({
      items: [
        item('message-1', 'TRAIN'),
        item('message-2', 'VALIDATION'),
        item('message-3', 'HOLDOUT'),
      ],
      verifications: [],
    });
    mockMessageQueries(prisma, [first], ['message-1', 'message-3']);
    const service = new AiEvidenceService(prisma, reclassification as never);

    const page = await service.reviewQueue('user-1', {
      fromAddress: 'notifications@github.com',
      subject: 'Aviso',
    });

    expect(page.counts).toEqual({
      TRAIN: 1,
      VALIDATION: 0,
      HOLDOUT: 1,
      all: 2,
    });
    expect(prisma.aiEmailMessage.findMany).toHaveBeenNthCalledWith(3, {
      where: {
        userId: 'user-1',
        fromAddress: {
          equals: 'notifications@github.com',
          mode: 'insensitive',
        },
        subject: { contains: 'Aviso', mode: 'insensitive' },
      },
      select: { id: true },
    });
  });

  it('applies classification filters to both queue items and partition counts', async () => {
    const matching = {
      ...message({
        id: 'message-2',
        receivedAt: '2026-10-25T12:00:00.000Z',
      }),
      classification: {
        semanticType: 'FIN_TRANSACTION',
        routes: ['FINANCE'],
        confidence: 0.45,
      },
    };
    const prisma = makePrisma({
      items: [
        item('message-1', 'TRAIN'),
        item('message-2', 'HOLDOUT'),
        item('message-3', 'VALIDATION'),
      ],
      verifications: [],
    });
    mockMessageQueries(prisma, [matching], ['message-2']);
    const service = new AiEvidenceService(prisma, reclassification as never);

    const page = await service.reviewQueue('user-1', {
      semanticType: 'FIN_TRANSACTION',
      route: 'FINANCE',
      confidenceMin: 0.3,
      confidenceMax: 0.6,
    });

    expect(page.items).toEqual([
      expect.objectContaining({
        id: 'message-2',
        semanticType: 'FIN_TRANSACTION',
        routes: ['FINANCE'],
        confidence: 0.45,
      }),
    ]);
    expect(page.counts).toEqual({
      TRAIN: 0,
      VALIDATION: 0,
      HOLDOUT: 1,
      all: 1,
    });
    expect(prisma.aiEmailMessage.findMany).toHaveBeenNthCalledWith(3, {
      where: {
        userId: 'user-1',
        AND: [
          {
            classifications: {
              some: {
                semanticType: 'FIN_TRANSACTION',
                route: 'FINANCE',
                confidence: { gte: 0.3, lte: 0.6 },
              },
            },
          },
        ],
      },
      select: { id: true },
    });
    expect(prisma.aiEmailMessage.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            {
              classifications: {
                some: {
                  semanticType: 'FIN_TRANSACTION',
                  route: 'FINANCE',
                  confidence: { gte: 0.3, lte: 0.6 },
                },
              },
            },
          ]),
        }),
      }),
    );
  });

  it('keeps the newest page and cursor without dropping the order', async () => {
    const messages = Array.from({ length: 51 }, (_, index) =>
      message({
        id: `message-${index}`,
        receivedAt: '2026-10-25T12:00:00.000Z',
      }),
    );
    const prisma = makePrisma({
      items: messages.map(({ id }) => item(id, 'TRAIN')),
      verifications: [],
    });
    mockMessageQueries(prisma, messages);
    const service = new AiEvidenceService(prisma, reclassification as never);

    const page = await service.reviewQueue('user-1', { order: 'NEWEST' });

    expect(page.hasMore).toBe(true);
    expect(page.items).toHaveLength(50);
    expect(decodeCursor(page.nextCursor ?? '')).toEqual({
      key: '2026-10-25T12:00:00.000Z',
      id: 'message-49',
    });
    expect(prisma.aiEmailMessage.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
        take: 51,
      }),
    );
  });

  it('continues an IMPACT page after the last message of the page is verified', async () => {
    const messages = Array.from({ length: 51 }, (_, index) =>
      message({
        id: `message-${String(index).padStart(2, '0')}`,
        receivedAt: '2026-10-25T12:00:00.000Z',
      }),
    );
    const prisma = makePrisma({
      items: messages.map(({ id }) => item(id, 'TRAIN')),
      verifications: [],
    });
    mockMessageQueries(prisma, messages);
    const service = new AiEvidenceService(prisma, reclassification as never);

    const first = await service.reviewQueue('user-1', { order: 'IMPACT' });
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).toEqual(expect.any(String));

    const remaining = messages.filter(({ id }) => id !== 'message-49');
    mockMessageQueries(prisma, remaining);
    const second = await service.reviewQueue('user-1', {
      order: 'IMPACT',
      cursor: first.nextCursor ?? undefined,
    });

    expect(second.items.map(({ id }) => id)).toEqual(['message-50']);
    expect(second.hasMore).toBe(false);
  });

  it('starts an IMPACT page at the recorded next message when the last one moves', async () => {
    const messages = Array.from({ length: 52 }, (_, index) =>
      message({
        id: `message-${String(index).padStart(2, '0')}`,
        receivedAt: '2026-10-25T12:00:00.000Z',
      }),
    );
    const prisma = makePrisma({
      items: messages.map(({ id }) => item(id, 'TRAIN')),
      verifications: [],
    });
    mockMessageQueries(prisma, messages);
    const service = new AiEvidenceService(prisma, reclassification as never);

    const first = await service.reviewQueue('user-1', { order: 'IMPACT' });
    expect(first.items).toHaveLength(50);

    const reordered = messages.map((stored) =>
      stored.id === 'message-49'
        ? { ...stored, classification: { confidence: 0.1 } }
        : stored,
    );
    mockMessageQueries(prisma, reordered);
    const second = await service.reviewQueue('user-1', {
      order: 'IMPACT',
      cursor: first.nextCursor ?? undefined,
    });

    expect(second.items.map(({ id }) => id)).toEqual([
      'message-50',
      'message-51',
    ]);
  });

  it('rejects an inverted date range before reading data', async () => {
    const prisma = makePrisma({
      items: [],
      verifications: [],
    });
    const service = new AiEvidenceService(prisma, reclassification as never);

    await expect(
      service.reviewQueue('user-1', {
        dateFrom: '2026-10-31',
        dateTo: '2026-10-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.aiDataset.upsert).not.toHaveBeenCalled();
    expect(prisma.aiEmailMessage.findMany).not.toHaveBeenCalled();
  });

  it('rejects a malformed cursor', async () => {
    const prisma = makePrisma({
      items: [],
      verifications: [],
    });
    const service = new AiEvidenceService(prisma, reclassification as never);

    await expect(
      service.reviewQueue('user-1', { cursor: 'not-a-cursor' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.aiEmailMessage.findMany).toHaveBeenCalledTimes(2);
  });

  it('excludes messages that no longer require review from items and counts', async () => {
    const pending = message({
      id: 'message-1',
      receivedAt: '2026-10-25T12:00:00.000Z',
    });
    const prisma = makePrisma({
      items: [item('message-1', 'TRAIN'), item('message-2', 'TRAIN')],
      verifications: [],
    });
    mockMessageQueries(prisma, [pending], undefined, ['message-2']);
    const service = new AiEvidenceService(prisma, reclassification as never);

    const page = await service.reviewQueue('user-1');

    expect(page.items).toEqual([
      expect.objectContaining({ id: 'message-1', status: 'PENDING' }),
    ]);
    expect(page.counts).toEqual({
      TRAIN: 1,
      VALIDATION: 0,
      HOLDOUT: 0,
      all: 1,
    });
    expect(prisma.aiEmailMessage.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        userId: 'user-1',
        processingStatus: { in: ['PROCESSED', 'DISCARDED'] },
      },
      select: { id: true },
    });
  });
});
