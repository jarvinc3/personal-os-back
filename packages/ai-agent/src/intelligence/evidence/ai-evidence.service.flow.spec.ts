import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AiEvidenceService } from './ai-evidence.service';

describe('AiEvidenceService review and analysis flows', () => {
  const makePrisma = () => ({
    aiDataset: {
      upsert: jest
        .fn()
        .mockResolvedValue({ id: 'dataset-1', name: 'EMAIL_V1' }),
    },
    aiDatasetItem: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue({ partition: 'TRAIN' }),
      groupBy: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    aiEmailMessage: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue({ id: 'email-1' }),
    },
    aiHumanVerification: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ sequence: 1n }),
    },
    userRole: { findUnique: jest.fn().mockResolvedValue(null) },
    aiAnalysisRun: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'run-1', status: 'RUNNING' }),
      update: jest.fn().mockResolvedValue({ id: 'run-1', status: 'COMPLETED' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    aiKnowledgeObservation: {
      create: jest.fn().mockResolvedValue({ sequence: 2n }),
    },
  });

  it('counts existing partitions and adds only missing messages', async () => {
    const prisma = makePrisma();
    prisma.aiEmailMessage.findMany.mockResolvedValue([
      { id: 'email-1' },
      { id: 'email-2' },
    ]);
    prisma.aiDatasetItem.findMany.mockResolvedValue([{ sourceId: 'email-1' }]);
    prisma.aiDatasetItem.groupBy.mockResolvedValue([
      { partition: 'TRAIN', _count: { _all: 1 } },
      { partition: 'HOLDOUT', _count: { _all: 1 } },
    ]);
    const service = new AiEvidenceService(prisma as never);

    expect(await service.datasetSummary('user-1')).toEqual({
      id: 'dataset-1',
      name: 'EMAIL_V1',
      partitions: { TRAIN: 1, VALIDATION: 0, HOLDOUT: 1 },
    });
    expect(prisma.aiDatasetItem.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ sourceId: 'email-2', userId: 'user-1' }),
      ],
      skipDuplicates: true,
    });
  });

  it('returns a review page with a cursor and excludes already reviewed messages', async () => {
    const prisma = makePrisma();
    prisma.aiHumanVerification.findMany.mockResolvedValue([
      { targetId: 'reviewed' },
    ]);
    prisma.aiDatasetItem.findMany.mockResolvedValue([
      { sourceId: 'email-1', partition: 'TRAIN' },
      { sourceId: 'email-2', partition: 'HOLDOUT' },
    ]);
    prisma.aiDatasetItem.groupBy.mockResolvedValue([
      { partition: 'TRAIN', _count: { _all: 1 } },
      { partition: 'HOLDOUT', _count: { _all: 1 } },
    ]);
    const messages = Array.from({ length: 51 }, (_, i) => ({
      id: i === 0 ? 'email-1' : `extra-${i}`,
      receivedAt: new Date('2026-10-25T12:00:00Z'),
    }));
    prisma.aiEmailMessage.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(messages);
    const service = new AiEvidenceService(prisma as never);
    const result = await service.reviewQueue('user-1', undefined, 'TRAIN');

    expect(result.counts).toEqual({
      TRAIN: 1,
      VALIDATION: 0,
      HOLDOUT: 1,
      all: 2,
    });
    expect(result.items).toEqual([{ ...messages[0], partition: 'TRAIN' }]);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBeTruthy();
    expect(prisma.aiDatasetItem.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sourceId: { notIn: ['reviewed'] } }),
      }),
    );
    expect(prisma.aiEmailMessage.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['email-1', 'email-2'] } }),
      }),
    );
  });

  it('rejects invalid partitions and cursors before querying messages', async () => {
    const prisma = makePrisma();
    const service = new AiEvidenceService(prisma as never);
    await expect(
      service.reviewQueue('user-1', undefined, 'OTHER'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.reviewQueue('user-1', 'not-a-cursor'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.aiHumanVerification.findMany).not.toHaveBeenCalled();
  });

  it('filters review messages after a valid cursor', async () => {
    const prisma = makePrisma();
    const service = new AiEvidenceService(prisma as never);
    const cursor = Buffer.from(
      JSON.stringify({
        receivedAt: '2026-10-25T12:00:00.000Z',
        id: 'email-1',
      }),
    ).toString('base64url');
    expect((await service.reviewQueue('user-1', cursor)).nextCursor).toBeNull();
    expect(prisma.aiEmailMessage.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ OR: expect.any(Array) }),
      }),
    );
  });

  it('rejects a missing target or an empty correction', async () => {
    const prisma = makePrisma();
    const service = new AiEvidenceService(prisma as never);
    prisma.aiEmailMessage.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.verifyMessage('user-1', 'missing', { verdict: 'CONFIRMED' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.verifyMessage('user-1', 'email-1', { verdict: 'CORRECTED' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('closes an analysis run with metrics or a bounded error', async () => {
    const prisma = makePrisma();
    const service = new AiEvidenceService(prisma as never);
    await service.completeAnalysisRun('user-1', 'run-1', {
      metrics: { reviewed: 3 },
    });
    expect(prisma.aiAnalysisRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'COMPLETED',
          metrics: { reviewed: 3 },
        }),
      }),
    );
    await service.completeAnalysisRun('user-1', 'run-1', {
      error: 'x'.repeat(2100),
    });
    expect(prisma.aiAnalysisRun.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          error: 'x'.repeat(2000),
        }),
      }),
    );
    prisma.aiAnalysisRun.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'run-1', status: 'FAILED' });
    await expect(
      service.completeAnalysisRun('user-1', 'missing', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.completeAnalysisRun('user-1', 'run-1', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('checks observation ownership and formats sequence values', async () => {
    const prisma = makePrisma();
    const service = new AiEvidenceService(prisma as never);
    const input = {
      userId: 'user-1',
      runId: 'run-1',
      knowledgeType: 'RULE',
      knowledgeKey: 'key',
      proposedScope: 'USER',
      sourceType: 'EMAIL_MESSAGE',
      sourceId: 'email-1',
      payload: { count: 1 },
    };
    expect((await service.recordObservation(input)).sequence).toBe('2');
    prisma.aiEmailMessage.findFirst.mockResolvedValueOnce(null);
    await expect(service.recordObservation(input)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    prisma.aiAnalysisRun.findFirst.mockResolvedValueOnce(null);
    await expect(service.recordObservation(input)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    prisma.aiAnalysisRun.findMany.mockResolvedValueOnce([
      {
        id: 'run-1',
        observationSequence: 2n,
        verificationSequence: 1n,
      },
    ]);
    expect(await service.listRuns('user-1')).toEqual([
      {
        id: 'run-1',
        observationSequence: '2',
        verificationSequence: '1',
      },
    ]);
  });
});
