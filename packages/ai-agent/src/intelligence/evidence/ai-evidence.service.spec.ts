import { BadRequestException } from '@nestjs/common';
import { AiEvidenceService } from './ai-evidence.service';

describe('AiEvidenceService', () => {
  it('appends a verification with role snapshot and marks HOLDOUT as ground truth', async () => {
    const create = jest.fn().mockResolvedValue({
      sequence: 8n,
      verifierRole: 'ADMIN',
      targetType: 'EMAIL_MESSAGE',
      targetId: 'message-1',
      verdict: 'CORRECTED',
      correctedPayload: { relevance: true },
      notes: null,
      isGroundTruth: true,
      createdAt: new Date('2026-10-25T12:00:00.000Z'),
    });
    const prisma = {
      aiDataset: { upsert: jest.fn().mockResolvedValue({ id: 'dataset-1' }) },
      aiEmailMessage: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ id: 'message-1' }),
      },
      aiDatasetItem: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ partition: 'HOLDOUT' }),
      },
      userRole: { findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }) },
      aiHumanVerification: { create },
    };
    const service = new AiEvidenceService(prisma as never);

    const result = await service.verifyMessage('user-1', 'message-1', {
      verdict: 'CORRECTED',
      relevance: true,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          verifierRole: 'ADMIN',
          correctedPayload: { relevance: true },
          isGroundTruth: true,
        }),
      }),
    );
    expect(result.sequence).toBe('8');
  });

  it('requires a reason when rejecting a message', async () => {
    const prisma = {
      aiDataset: { upsert: jest.fn().mockResolvedValue({ id: 'dataset-1' }) },
      aiEmailMessage: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ id: 'message-1' }),
      },
      aiDatasetItem: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ partition: 'TRAIN' }),
      },
      userRole: { findUnique: jest.fn().mockResolvedValue(null) },
      aiHumanVerification: { create: jest.fn() },
    };
    const service = new AiEvidenceService(prisma as never);

    await expect(
      service.verifyMessage('user-1', 'message-1', { verdict: 'REJECTED' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.aiHumanVerification.create).not.toHaveBeenCalled();
  });

  it('captures sequence watermarks and the run configuration at creation', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'run-1' });
    const prisma = {
      aiDataset: { upsert: jest.fn().mockResolvedValue({ id: 'dataset-1' }) },
      aiEmailMessage: { findMany: jest.fn().mockResolvedValue([]) },
      aiDatasetItem: { findMany: jest.fn().mockResolvedValue([]) },
      aiKnowledgeObservation: {
        aggregate: jest.fn().mockResolvedValue({ _max: { sequence: 14n } }),
      },
      aiHumanVerification: {
        aggregate: jest.fn().mockResolvedValue({ _max: { sequence: 9n } }),
      },
      aiAnalysisRun: { create },
    };
    const service = new AiEvidenceService(prisma as never);

    await service.startAnalysisRun('user-1', 'EVALUATE', { policy: 'v2' });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        observationSequence: 14n,
        verificationSequence: 9n,
        mode: 'EVALUATE',
        configuration: { policy: 'v2' },
      }),
    });
  });
});
