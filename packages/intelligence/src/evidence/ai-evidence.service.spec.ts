import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { AiEvidenceService } from './ai-evidence.service';
import { CreateHumanVerificationDto } from './dto/create-human-verification.dto';

const reclassification = {
  reclassifyAfterMessageVerification: jest
    .fn()
    .mockResolvedValue({ requeued: 0 }),
  reclassifyAfterReviewGroupVerification: jest
    .fn()
    .mockResolvedValue({ requeued: 0 }),
};

describe('AiEvidenceService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const reviewPrisma = () => {
    const prisma = {
      aiDataset: { upsert: jest.fn().mockResolvedValue({ id: 'dataset-1' }) },
      aiEmailMessage: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({
          id: 'message-1',
          fromAddress: 'bank@example.com',
          templateFingerprint: 'fp-bank',
        }),
      },
      aiDatasetItem: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ partition: 'TRAIN' }),
      },
      userRole: { findUnique: jest.fn().mockResolvedValue(null) },
      aiHumanVerification: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ sequence: 1n }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(
      (callback: (tx: unknown) => unknown) => callback(prisma),
    );
    return prisma;
  };

  it.each([
    [{ semanticType: 'FIN_TRANSACTION' }, 'transacción'],
    [
      {
        semanticType: 'PURCHASE_RECEIPT',
        transaction: { kind: 'TRANSACTION' },
      },
      'kind',
    ],
    [{ semanticType: 'MARKETING', transaction: {} }, 'transacción'],
    [{ semanticType: 'OTHER' }, 'nota'],
    [{ semanticType: 'SECURITY_ALERT', relevance: false }, 'Relevancia'],
    [{ semanticType: 'SECURITY_OTP', relevance: true }, 'Relevancia'],
  ] as const)('rejects inconsistent labels %#', async (labels, error) => {
    const prisma = reviewPrisma();
    const service = new AiEvidenceService(
      prisma as never,
      reclassification as never,
    );
    await expect(
      service.verifyMessage('user-1', 'message-1', {
        verdict: 'CORRECTED',
        ...labels,
      }),
    ).rejects.toThrow(error);
    expect(prisma.aiHumanVerification.create).not.toHaveBeenCalled();
  });

  it('stores an empty route list and a complete financial transaction', async () => {
    const prisma = reviewPrisma();
    const service = new AiEvidenceService(
      prisma as never,
      reclassification as never,
    );
    await service.verifyMessage('user-1', 'message-1', {
      verdict: 'CORRECTED',
      semanticType: 'FIN_TRANSACTION',
      routes: [],
      transaction: {
        kind: 'TRANSACTION',
        amount: 1250,
        currency: 'DOP',
        direction: 'DEBIT',
      },
    });
    expect(prisma.aiHumanVerification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          correctedPayload: {
            semanticType: 'FIN_TRANSACTION',
            routes: [],
            transaction: {
              kind: 'TRANSACTION',
              amount: 1250,
              currency: 'DOP',
              direction: 'DEBIT',
            },
          },
        }),
      }),
    );
  });
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
      aiHumanVerification: {
        findFirst: jest.fn().mockResolvedValue(null),
        create,
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(
      (callback: (tx: unknown) => unknown) => callback(prisma),
    );
    const service = new AiEvidenceService(
      prisma as never,
      reclassification as never,
    );

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
      aiHumanVerification: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
    };
    const service = new AiEvidenceService(
      prisma as never,
      reclassification as never,
    );

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
      aiConsentEvent: {
        aggregate: jest.fn().mockResolvedValue({ _max: { sequence: 3n } }),
      },
      aiAnalysisRun: { create },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        callback(prisma),
      ),
    };
    const service = new AiEvidenceService(
      prisma as never,
      reclassification as never,
    );

    await service.startAnalysisRun('user-1', 'EVALUATE', { policy: 'v2' });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        observationSequence: 14n,
        verificationSequence: 9n,
        consentRevision: 3n,
        mode: 'EVALUATE',
        configuration: { policy: 'v2', snapshot: 'REPEATABLE_READ' },
      }),
    });
  });

  it('reutiliza la verificación idéntica y reintenta la reclasificación sin otra fila', async () => {
    const created = {
      sequence: 1n,
      verifierRole: 'USER',
      targetType: 'EMAIL_MESSAGE',
      targetId: 'message-1',
      verdict: 'CONFIRMED',
      correctedPayload: null,
      notes: null,
      isGroundTruth: false,
      createdAt: new Date('2026-11-01T00:00:00.000Z'),
    };
    const prisma = reviewPrisma();
    prisma.aiHumanVerification.findFirst = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue(created);
    prisma.aiHumanVerification.create.mockResolvedValue(created);
    const service = new AiEvidenceService(
      prisma as never,
      reclassification as never,
    );

    await service.verifyMessage('user-1', 'message-1', {
      verdict: 'CONFIRMED',
    });
    const retried = await service.verifyMessage('user-1', 'message-1', {
      verdict: 'CONFIRMED',
    });

    expect(prisma.aiHumanVerification.create).toHaveBeenCalledTimes(1);
    expect(retried).toMatchObject({ sequence: '1', requeued: 0 });
    expect(
      reclassification.reclassifyAfterMessageVerification,
    ).toHaveBeenCalledTimes(2);
  });

  it('reutiliza la verificación idéntica cuando transaction llega como DTO transformado', async () => {
    const correctedPayload = {
      relevance: true,
      semanticType: 'FIN_TRANSACTION',
      routes: ['FINANCE'],
      transaction: {
        kind: 'TRANSACTION',
        amount: 37.25,
        currency: 'DOP',
        transactionDate: '2031-04-12T12:00:00.000Z',
        direction: 'DEBIT',
        merchant: 'Comercio sintético CTR-02',
        bankReference: 'SYN-CTR02-REF',
        last4: '4821',
      },
    };
    const stored = {
      sequence: 7n,
      verifierRole: 'USER',
      targetType: 'EMAIL_MESSAGE',
      targetId: 'message-1',
      verdict: 'CORRECTED',
      correctedPayload,
      notes: 'Reintento sintético CTR-02',
      isGroundTruth: false,
      createdAt: new Date('2026-11-01T00:00:00.000Z'),
    };
    const prisma = reviewPrisma();
    prisma.aiHumanVerification.findFirst.mockResolvedValue(stored);
    const service = new AiEvidenceService(
      prisma as never,
      reclassification as never,
    );
    const request = plainToInstance(CreateHumanVerificationDto, {
      verdict: 'CORRECTED',
      ...correctedPayload,
      notes: 'Reintento sintético CTR-02',
    });

    const reusedVerification = await service.verifyMessage(
      'user-1',
      'message-1',
      request,
    );

    expect(prisma.aiHumanVerification.create).not.toHaveBeenCalled();
    expect(reusedVerification.sequence).toBe('7');
    expect(
      reclassification.reclassifyAfterMessageVerification,
    ).toHaveBeenCalledTimes(1);
  });

  it('registra otra verificación cuando cambian las etiquetas', async () => {
    const prisma = reviewPrisma();
    prisma.aiHumanVerification.findFirst.mockResolvedValue({
      sequence: 1n,
      verdict: 'CONFIRMED',
      correctedPayload: null,
      notes: null,
    });
    prisma.aiHumanVerification.create.mockResolvedValue({ sequence: 2n });
    const service = new AiEvidenceService(
      prisma as never,
      reclassification as never,
    );

    await service.verifyMessage('user-1', 'message-1', {
      verdict: 'CORRECTED',
      relevance: true,
    });

    expect(prisma.aiHumanVerification.create).toHaveBeenCalledTimes(1);
  });

  it('propaga el fallo de reclasificación y el reintento idéntico no duplica evidencia', async () => {
    const created = {
      sequence: 1n,
      verifierRole: 'USER',
      targetType: 'EMAIL_MESSAGE',
      targetId: 'message-1',
      verdict: 'CONFIRMED',
      correctedPayload: null,
      notes: null,
      isGroundTruth: false,
      createdAt: new Date('2026-11-01T00:00:00.000Z'),
    };
    const prisma = reviewPrisma();
    prisma.aiHumanVerification.findFirst = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue(created);
    prisma.aiHumanVerification.create.mockResolvedValue(created);
    reclassification.reclassifyAfterMessageVerification
      .mockRejectedValueOnce(new Error('database down'))
      .mockResolvedValueOnce({ requeued: 4 });
    const service = new AiEvidenceService(
      prisma as never,
      reclassification as never,
    );

    await expect(
      service.verifyMessage('user-1', 'message-1', { verdict: 'CONFIRMED' }),
    ).rejects.toThrow('Reintenta la misma verificación');
    expect(prisma.aiHumanVerification.create).toHaveBeenCalledTimes(1);

    await expect(
      service.verifyMessage('user-1', 'message-1', { verdict: 'CONFIRMED' }),
    ).resolves.toMatchObject({ requeued: 4 });
    expect(prisma.aiHumanVerification.create).toHaveBeenCalledTimes(1);
  });
});
