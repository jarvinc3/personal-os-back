import { BadRequestException } from '@nestjs/common';
import { decodeCursor } from '@personal-os/core';
import { AiEvidenceService } from './ai-evidence.service';

type StoredMessage = {
  id: string;
  userId: string;
  receivedAt: Date;
  fromAddress: string;
  fromDomain: string;
  subject: string;
  contentFingerprint: string;
  processingStatus: string;
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
  partitionCounts = [],
}: {
  items: StoredItem[];
  verifications: StoredVerification[];
  partitionCounts?: Array<{
    partition: StoredItem['partition'];
    count: number;
  }>;
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
      groupBy: jest.fn().mockResolvedValue(
        partitionCounts.map(({ partition, count }) => ({
          partition,
          _count: { _all: count },
        })),
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
  };
  return prisma;
}

function mockMessageQueries(
  prisma: ReturnType<typeof makePrisma>,
  pageMessages: StoredMessage[],
) {
  prisma.aiEmailMessage.findMany
    .mockResolvedValueOnce([{ id: 'dataset-message' }])
    .mockResolvedValueOnce(pageMessages);
}

describe('AiEvidenceService review queue filters', () => {
  it('lists pending messages with a derived status and the current counts', async () => {
    const pending = message({
      id: 'message-1',
      receivedAt: '2026-10-25T12:00:00.000Z',
    });
    const prisma = makePrisma({
      items: [item('message-1', 'TRAIN')],
      verifications: [],
      partitionCounts: [
        { partition: 'TRAIN', count: 1 },
        { partition: 'HOLDOUT', count: 2 },
      ],
    });
    mockMessageQueries(prisma, [pending]);
    const service = new AiEvidenceService(prisma as never);

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
        where: { userId: 'user-1' },
        orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
        take: 51,
      }),
    );
    expect(prisma.aiDatasetItem.groupBy).toHaveBeenCalledWith({
      by: ['partition'],
      where: {
        datasetId: 'dataset-1',
        userId: 'user-1',
        sourceType: 'EMAIL_MESSAGE',
      },
      _count: { _all: true },
    });
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
      partitionCounts: [{ partition: 'HOLDOUT', count: 1 }],
    });
    mockMessageQueries(prisma, [first]);
    const service = new AiEvidenceService(prisma as never);

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
    expect(prisma.aiDatasetItem.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sourceId: { notIn: ['message-1', 'message-2'] },
        }),
      }),
    );
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
      HOLDOUT: 1,
      all: 1,
    });
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
    const service = new AiEvidenceService(prisma as never);

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

  it('rejects an inverted date range before reading data', async () => {
    const prisma = makePrisma({
      items: [],
      verifications: [],
    });
    const service = new AiEvidenceService(prisma as never);

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
    const service = new AiEvidenceService(prisma as never);

    await expect(
      service.reviewQueue('user-1', { cursor: 'not-a-cursor' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.aiEmailMessage.findMany).toHaveBeenCalledTimes(1);
  });
});
