import type { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';
import type { ModuleSettingsReader } from '@personal-os/contracts';
import type { PrismaService } from '@personal-os/database';
import {
  StructuredInferenceOutputError,
  StructuredInferenceProviderError,
} from '@personal-os/contracts';
import type { InferenceCompletionPort } from '@personal-os/contracts';
import { AiEmailClassificationService } from './ai-email-classification.service';
import { knowledgeKeys } from '../knowledge/knowledge-normalizer';

function fixture(
  options: {
    body?: string;
    fromAddress?: string;
    fromDomain?: string;
    subject?: string;
    receivedAt?: Date;
    knowledge?: unknown[];
    role?: string;
    budgetAvailable?: boolean;
    inferenceValue?: unknown;
    reviewSettings?: {
      reviewConfidenceThreshold?: number;
      acceptVerifiedSenders?: boolean;
    };
  } = {},
) {
  const tx = {
    aiDataset: { upsert: jest.fn().mockResolvedValue({ id: 'dataset' }) },
    aiDatasetItem: { upsert: jest.fn().mockResolvedValue({}) },
    aiKnowledgeObservation: {
      aggregate: jest.fn().mockResolvedValue({ _max: { sequence: null } }),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    aiHumanVerification: {
      aggregate: jest.fn().mockResolvedValue({ _max: { sequence: null } }),
    },
    aiConsentEvent: {
      aggregate: jest.fn().mockResolvedValue({ _max: { sequence: null } }),
    },
    aiAnalysisRun: {
      create: jest.fn().mockResolvedValue({ id: 'run' }),
      update: jest.fn().mockResolvedValue({}),
    },
    aiEmailClassification: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    aiSignal: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    aiSignalEvidence: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    domainEventOutbox: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    aiEmailMessage: {
      findMany: jest.fn().mockResolvedValue([{ id: 'message-1' }]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn().mockResolvedValue({
        id: 'message-1',
        receivedAt: options.receivedAt ?? new Date('2026-10-01T12:00:00Z'),
        providerThreadId: 'thread-1',
        fromAddress: options.fromAddress ?? 'notice@example.com',
        fromDomain: options.fromDomain ?? 'example.com',
        subject: options.subject ?? 'Notice',
        templateFingerprint: 'template-1',
        content: { sanitizedBody: options.body ?? 'A regular email.' },
      }),
    },
    aiKnowledge: {
      findMany: jest.fn().mockResolvedValue(options.knowledge ?? []),
    },
    userRole: {
      findUnique: jest.fn().mockResolvedValue({ role: options.role ?? 'USER' }),
    },
    userAiSettings: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ contributeToGlobalKnowledge: true }),
    },
    aiEmailModelBudget: {
      upsert: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest
        .fn()
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({
          count: options.budgetAvailable === false ? 0 : 1,
        }),
    },
    ...tx,
    $transaction: jest.fn(async (queries: Promise<unknown>[]) =>
      Promise.all(queries),
    ),
  };
  const inference = {
    infer: jest.fn().mockResolvedValue({
      provider: 'test-provider',
      model: 'test-model',
      value: options.inferenceValue ?? {
        relevance: true,
        semanticType: 'FIN_TRANSACTION',
        routes: ['FINANCE', 'SUBSCRIPTIONS'],
        transaction: { kind: 'TRANSACTION' },
        confidence: 0.9,
      },
    }),
  };
  const config = { get: jest.fn(() => 100) };
  const moduleSettings = options.reviewSettings
    ? {
        read: jest.fn().mockResolvedValue({
          enabled: true,
          version: 1,
          config: {
            email: {
              reviewConfidenceThreshold:
                options.reviewSettings.reviewConfidenceThreshold ?? 0.7,
              acceptVerifiedSenders:
                options.reviewSettings.acceptVerifiedSenders ?? false,
            },
          },
        }),
      }
    : undefined;
  return {
    service: new AiEmailClassificationService(
      prisma as unknown as PrismaService,
      inference as unknown as InferenceCompletionPort,
      config as unknown as ConfigService<Env, true>,
      moduleSettings as unknown as ModuleSettingsReader | undefined,
    ),
    prisma,
    inference,
  };
}

describe('AiEmailClassificationService', () => {
  it('does not call the model for a deterministic OTP', async () => {
    const { service, inference, prisma } = fixture({
      body: 'Your verification code is 123456.',
    });
    await service.processPendingForUser('user-1');
    expect(inference.infer).not.toHaveBeenCalled();
    expect(prisma.aiEmailClassification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            semanticType: 'SECURITY_OTP',
            route: 'SECURITY',
          }),
        ],
      }),
    );
  });

  it('does not call the model for known irrelevant knowledge', async () => {
    const { service, inference } = fixture({
      knowledge: [
        {
          id: 'k1',
          knowledgeType: 'EMAIL_TEMPLATE',
          knowledgeKey: 'x',
          scope: 'USER',
          payload: {
            label: { relevance: false, semanticType: 'MARKETING', routes: [] },
          },
        },
      ],
    });
    await service.processPendingForUser('user-1');
    expect(inference.infer).not.toHaveBeenCalled();
  });

  it('uses the model for unknown mail and stores one independent classification per route', async () => {
    const { service, inference, prisma } = fixture();
    await service.processPendingForUser('user-1');
    expect(inference.infer).toHaveBeenCalledTimes(1);
    expect(prisma.aiEmailClassification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            route: 'FINANCE',
            provider: 'test-provider',
            model: 'test-model',
          }),
          expect.objectContaining({
            route: 'SUBSCRIPTIONS',
            provider: 'test-provider',
            model: 'test-model',
          }),
        ]),
      }),
    );
    expect(prisma).not.toHaveProperty('financeTransaction');
  });

  it('publishes one idempotent signal with evidence and outbox event per email candidate', async () => {
    const { service, prisma } = fixture();
    await service.processPendingForUser('user-1');
    expect(prisma.aiSignal.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          id: 'email-message-1',
          userId: 'user-1',
          sourceId: 'message-1',
          correlationKey: 'user-1:email:message-1',
          status: 'ROUTED',
          payload: expect.objectContaining({
            routes: ['FINANCE', 'SUBSCRIPTIONS'],
          }),
        }),
      ],
      skipDuplicates: true,
    });
    expect(prisma.aiSignalEvidence.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ signalId: 'email-message-1' })],
        skipDuplicates: true,
      }),
    );
    expect(prisma.domainEventOutbox.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ eventName: 'ai.signal.routed' })],
        skipDuplicates: true,
      }),
    );
    expect(prisma).not.toHaveProperty('financeTransaction');
  });

  it('fills the suggested date from the header and sends it to Finance', async () => {
    const { service, prisma } = fixture({
      inferenceValue: {
        relevance: true,
        semanticType: 'FIN_TRANSACTION',
        routes: ['FINANCE'],
        transaction: {
          kind: 'TRANSACTION',
          amount: 1_500,
          currency: 'DOP',
          direction: 'DEBIT',
        },
        confidence: 0.9,
      },
    });

    await service.processPendingForUser('user-1');

    const storedRows = prisma.aiEmailClassification.createMany.mock.calls[0][0]
      .data as Array<{ transaction: Record<string, unknown> }>;
    expect(storedRows[0].transaction).toMatchObject({
      suggestedTransactionDate: '2026-10-01T12:00:00.000Z',
      suggestedTransactionDateSource: 'EMAIL_HEADER',
    });
    expect(storedRows[0].transaction).not.toHaveProperty('transactionDate');

    const signal = prisma.aiSignal.createMany.mock.calls[0][0].data[0] as {
      payload: { transaction: Record<string, unknown> };
    };
    expect(signal.payload.transaction).toMatchObject({
      suggestedTransactionDate: '2026-10-01T12:00:00.000Z',
      suggestedTransactionDateSource: 'EMAIL_HEADER',
    });
    expect(signal.payload.transaction).not.toHaveProperty('transactionDate');

    expect(prisma.aiEmailMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          classification: expect.objectContaining({
            transaction: expect.objectContaining({
              suggestedTransactionDate: '2026-10-01T12:00:00.000Z',
              suggestedTransactionDateSource: 'EMAIL_HEADER',
            }),
          }),
        }),
      }),
    );
  });

  it('grounds a BHD date and currency from the text and records the contradiction', async () => {
    const { service, prisma } = fixture({
      fromAddress: 'alertas@bhd.com.do',
      fromDomain: 'bhd.com.do',
      subject: 'BHD Notificación de Transacciones',
      receivedAt: new Date('2026-11-06T15:12:00.000Z'),
      body: [
        'Monto:',
        'US$ 138.79',
        'Fecha y hora de la transacción:',
        '06/11/2026 - 11:12 AM',
      ].join('\n'),
      inferenceValue: {
        relevance: true,
        semanticType: 'FIN_TRANSACTION',
        routes: ['FINANCE'],
        transaction: {
          kind: 'TRANSACTION',
          amount: 138.79,
          currency: 'DOP',
          transactionDate: '2026-06-11T11:12:00.000Z',
          direction: 'DEBIT',
          movementClass: 'PURCHASE',
          bankStatusNormalized: 'APPROVED',
        },
        confidence: 0.9,
      },
    });

    await service.processPendingForUser('user-1');

    const storedRows = prisma.aiEmailClassification.createMany.mock.calls[0][0]
      .data as Array<{ transaction: Record<string, unknown> }>;
    expect(storedRows[0].transaction).toMatchObject({
      transactionDate: '2026-11-06T15:12:00.000Z',
      currency: 'USD',
      currencyEvidence: expect.stringContaining('modelo propuso DOP'),
    });
    const signal = prisma.aiSignal.createMany.mock.calls[0][0].data[0] as {
      payload: { transaction: Record<string, unknown> };
    };
    expect(signal.payload.transaction).toMatchObject({
      transactionDate: '2026-11-06T15:12:00.000Z',
      currency: 'USD',
      currencyEvidence: expect.stringContaining('modelo propuso DOP'),
    });
    const evidence = prisma.aiSignalEvidence.createMany.mock.calls[0][0]
      .data[0] as {
      excerpt: { transaction: Record<string, unknown> };
    };
    expect(evidence.excerpt.transaction).toMatchObject({
      currency: 'USD',
      currencyEvidence: expect.stringContaining('modelo propuso DOP'),
    });
  });

  it('forces a BHD reversal to REFUND instead of a purchase', async () => {
    const { service, prisma } = fixture({
      fromAddress: 'alertas@bhd.com.do',
      fromDomain: 'bhd.com.do',
      subject: 'BHD Notificación de Transacciones',
      receivedAt: new Date('2026-11-06T15:12:00.000Z'),
      body: [
        'Fecha',
        'Moneda',
        'Monto',
        'Comercio',
        'Estado',
        'Tipo',
        '06/11/2026 11:12 am',
        'RD',
        '$138.79',
        'COMERCIO SINTETICO',
        'Aprobada',
        'Reverso',
      ].join('\n'),
      inferenceValue: {
        relevance: true,
        semanticType: 'FIN_TRANSACTION',
        routes: ['FINANCE'],
        transaction: {
          kind: 'TRANSACTION',
          amount: 138.79,
          currency: 'USD',
          transactionDate: '2026-06-11T11:12:00.000Z',
          direction: 'DEBIT',
          movementClass: 'PURCHASE',
          bankStatusNormalized: 'APPROVED',
        },
        confidence: 0.9,
      },
    });

    await service.processPendingForUser('user-1');

    const storedRows = prisma.aiEmailClassification.createMany.mock.calls[0][0]
      .data as Array<{ transaction: Record<string, unknown> }>;
    expect(storedRows[0].transaction).toMatchObject({
      movementClass: 'REFUND',
      direction: 'CREDIT',
      bankStatusNormalized: 'REVERSED',
      transactionDate: '2026-11-06T15:12:00.000Z',
      currency: 'DOP',
    });
  });

  it('suggests the header date when the BHD text cannot verify the operation date', async () => {
    const { service, prisma } = fixture({
      fromAddress: 'alertas@bhd.com.do',
      fromDomain: 'bhd.com.do',
      subject: 'BHD Notificación de Transacciones',
      receivedAt: new Date('2026-11-06T15:12:00.000Z'),
      body: 'Monto: RD$ 138.79\nSin fecha de operación en el texto.',
      inferenceValue: {
        relevance: true,
        semanticType: 'FIN_TRANSACTION',
        routes: ['FINANCE'],
        transaction: {
          kind: 'TRANSACTION',
          amount: 138.79,
          currency: 'USD',
          transactionDate: '2026-06-11T11:12:00.000Z',
          direction: 'DEBIT',
          movementClass: 'PURCHASE',
          bankStatusNormalized: 'APPROVED',
        },
        confidence: 0.9,
      },
    });

    await service.processPendingForUser('user-1');

    const storedRows = prisma.aiEmailClassification.createMany.mock.calls[0][0]
      .data as Array<{ transaction: Record<string, unknown> }>;
    expect(storedRows[0].transaction).not.toHaveProperty('transactionDate');
    expect(storedRows[0].transaction).toMatchObject({
      suggestedTransactionDate: '2026-11-06T15:12:00.000Z',
      suggestedTransactionDateSource: 'EMAIL_HEADER',
      currency: 'DOP',
    });
  });

  it('leaves a message queued and avoids inference when the daily budget is exhausted', async () => {
    const { service, inference, prisma } = fixture({ budgetAvailable: false });
    await service.processPendingForUser('user-1');
    expect(inference.infer).not.toHaveBeenCalled();
    expect(prisma.aiEmailMessage.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: { processingStatus: 'QUEUED', classificationStartedAt: null },
      }),
    );
  });

  it('uses the per-user review confidence threshold for a model classification', async () => {
    const { service, prisma } = fixture({
      reviewSettings: { reviewConfidenceThreshold: 0.8 },
      inferenceValue: {
        relevance: true,
        semanticType: 'FIN_TRANSACTION',
        routes: ['FINANCE'],
        transaction: { kind: 'TRANSACTION' },
        confidence: 0.75,
      },
    });

    await service.processPendingForUser('user-1');

    expect(prisma.aiEmailMessage.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ processingStatus: 'REVIEW_REQUIRED' }),
      }),
    );
  });

  it('auto-accepts a verified sender only when the user enables the setting', async () => {
    const knowledge = [
      {
        id: 'sender-knowledge',
        knowledgeType: 'EMAIL_SENDER',
        knowledgeKey: 'notice@example.com',
        scope: 'USER' as const,
        payload: { label: { relevance: true } },
      },
    ];
    const { service, prisma, inference } = fixture({
      knowledge,
      reviewSettings: {
        reviewConfidenceThreshold: 0.8,
        acceptVerifiedSenders: true,
      },
    });

    await service.processPendingForUser('user-1');

    expect(inference.infer).not.toHaveBeenCalled();
    expect(prisma.aiEmailMessage.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ processingStatus: 'PROCESSED' }),
      }),
    );
  });

  it('honors sender verification when a template label is the primary knowledge match', async () => {
    const templateKey = knowledgeKeys('notice@example.com', 'Notice').find(
      ({ knowledgeType }) => knowledgeType === 'EMAIL_TEMPLATE',
    )?.knowledgeKey;
    if (!templateKey) {
      throw new Error('Expected a normalized template knowledge key');
    }
    const { service, prisma } = fixture({
      knowledge: [
        {
          id: 'sender-knowledge',
          knowledgeType: 'EMAIL_SENDER',
          knowledgeKey: 'notice@example.com',
          scope: 'USER',
          payload: {
            label: {
              relevance: true,
              semanticType: 'FIN_TRANSACTION',
              routes: ['FINANCE'],
              transaction: { kind: 'TRANSACTION' },
            },
          },
        },
        {
          id: 'template-knowledge',
          knowledgeType: 'EMAIL_TEMPLATE',
          knowledgeKey: templateKey,
          scope: 'USER',
          payload: { label: { relevance: true } },
        },
      ],
      reviewSettings: {
        reviewConfidenceThreshold: 0.8,
        acceptVerifiedSenders: true,
      },
    });

    await service.processPendingForUser('user-1');

    expect(prisma.aiEmailMessage.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ processingStatus: 'PROCESSED' }),
      }),
    );
  });
});

describe('AiEmailClassificationService direct message operations', () => {
  function expectNoWrites(prisma: ReturnType<typeof fixture>['prisma']) {
    expect(prisma.aiEmailMessage.updateMany).not.toHaveBeenCalled();
    expect(prisma.aiEmailClassification.createMany).not.toHaveBeenCalled();
    expect(prisma.aiSignal.createMany).not.toHaveBeenCalled();
    expect(prisma.aiSignalEvidence.createMany).not.toHaveBeenCalled();
    expect(prisma.domainEventOutbox.createMany).not.toHaveBeenCalled();
    expect(prisma.aiDataset.upsert).not.toHaveBeenCalled();
    expect(prisma.aiDatasetItem.upsert).not.toHaveBeenCalled();
    expect(prisma.aiAnalysisRun.create).not.toHaveBeenCalled();
    expect(prisma.aiKnowledgeObservation.createMany).not.toHaveBeenCalled();
    expect(prisma.aiEmailModelBudget.upsert).not.toHaveBeenCalled();
    expect(prisma.aiEmailModelBudget.updateMany).not.toHaveBeenCalled();
  }

  it('previews a classification with the model and writes nothing', async () => {
    const { service, inference, prisma } = fixture();

    const preview = await service.previewClassification({
      userId: 'user-1',
      messageId: 'message-1',
    });

    expect(preview).toMatchObject({
      kind: 'classified',
      method: 'MODEL',
      provider: 'test-provider',
      model: 'test-model',
      classification: {
        semanticType: 'FIN_TRANSACTION',
        confidence: 0.9,
      },
    });
    expect(inference.infer).toHaveBeenCalledTimes(1);
    expectNoWrites(prisma);
  });

  it('reports a missing budget in the preview without calling the model', async () => {
    const { service, inference, prisma } = fixture();
    prisma.aiEmailModelBudget.updateMany = jest
      .fn()
      .mockResolvedValue({ count: 0 });
    prisma.aiEmailModelBudget.findFirst = jest
      .fn()
      .mockResolvedValue({ calls: 100, dailyLimit: 100 });

    const preview = await service.previewClassification({
      userId: 'user-1',
      messageId: 'message-1',
    });

    expect(preview).toEqual({
      kind: 'unavailable',
      reason: 'MODEL_BUDGET_EXHAUSTED',
    });
    expect(inference.infer).not.toHaveBeenCalled();
    expectNoWrites(prisma);
  });

  it('reclassifies one chosen message and replaces its stored rows', async () => {
    const { service, prisma } = fixture();
    prisma.aiEmailClassification.deleteMany = jest
      .fn()
      .mockResolvedValue({ count: 1 });

    const reclassification = await service.reclassifyMessageNow({
      userId: 'user-1',
      messageId: 'message-1',
    });

    expect(reclassification).toMatchObject({
      kind: 'classified',
      method: 'MODEL',
    });
    expect(prisma.aiEmailClassification.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', messageId: 'message-1' },
    });
    expect(prisma.aiEmailMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'message-1', userId: 'user-1' },
        data: expect.objectContaining({ processingStatus: 'CLASSIFYING' }),
      }),
    );
    expect(prisma.aiSignal.createMany).toHaveBeenCalled();
    expect(prisma.domainEventOutbox.createMany).toHaveBeenCalled();
  });

  it('reports a message outside the user without writing', async () => {
    const { service, prisma } = fixture();
    prisma.aiEmailMessage.findFirst = jest.fn().mockResolvedValue(null);

    await expect(
      service.previewClassification({
        userId: 'user-1',
        messageId: 'message-9',
      }),
    ).resolves.toEqual({ kind: 'not_found' });
    expectNoWrites(prisma);
  });
});

describe('AiEmailClassificationService model call accounting', () => {
  it('reports one model call when the model classified the mail', async () => {
    const { service } = fixture();

    await expect(service.processPendingForUser('user-1')).resolves.toEqual({
      processed: 1,
      modelCalls: 1,
    });
  });

  it('reports no model call for a deterministic classification', async () => {
    const { service } = fixture({
      body: 'Your verification code is 123456.',
    });

    await expect(service.processPendingForUser('user-1')).resolves.toEqual({
      processed: 1,
      modelCalls: 0,
    });
  });
});

describe('AiEmailClassificationService rejected model output', () => {
  function rejection() {
    return new StructuredInferenceOutputError(
      'Groq',
      'qwen/qwen3.8-27b',
      1,
      'SCHEMA_VALIDATION:transaction:invalid_type',
    );
  }

  it('keeps a non-financial notice that arrives with kind NOT_TRANSACTION', async () => {
    const { service } = fixture({
      inferenceValue: {
        relevance: true,
        semanticType: 'FIN_ACCOUNT_NOTICE',
        routes: ['FINANCE'],
        transaction: { kind: 'NOT_TRANSACTION' },
        confidence: 0.95,
      },
    });

    const preview = await service.previewClassification({
      userId: 'user-1',
      messageId: 'message-1',
    });

    expect(preview).toMatchObject({
      kind: 'classified',
      classification: { semanticType: 'FIN_ACCOUNT_NOTICE' },
    });
    if (preview.kind !== 'classified') {
      throw new Error('Expected a classified preview');
    }
    expect(preview.classification.transaction).toBeUndefined();
  });

  it('retries once with the rejection and stores the repaired label', async () => {
    const { service, inference } = fixture();
    inference.infer.mockRejectedValueOnce(rejection());

    const preview = await service.previewClassification({
      userId: 'user-1',
      messageId: 'message-1',
    });

    expect(inference.infer).toHaveBeenCalledTimes(2);
    const repairRequest = inference.infer.mock.calls[1][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(repairRequest.messages.at(-1)).toMatchObject({
      role: 'user',
      content: expect.stringContaining(
        'SCHEMA_VALIDATION:transaction:invalid_type',
      ),
    });
    expect(preview).toMatchObject({ kind: 'classified', method: 'MODEL' });
  });

  it('leaves the message for review when the repair also fails', async () => {
    const { service, inference, prisma } = fixture();
    inference.infer.mockRejectedValue(rejection());

    await service.processPendingForUser('user-1');

    expect(inference.infer).toHaveBeenCalledTimes(2);
    expect(prisma.aiEmailClassification.createMany).not.toHaveBeenCalled();
    expect(prisma.aiEmailMessage.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ processingStatus: 'REVIEW_REQUIRED' }),
      }),
    );
  });

  it('reports the same failure in the preview without writing', async () => {
    const { service, inference, prisma } = fixture();
    inference.infer.mockRejectedValue(rejection());

    await expect(
      service.previewClassification({
        userId: 'user-1',
        messageId: 'message-1',
      }),
    ).resolves.toEqual({
      kind: 'unavailable',
      reason: 'STRUCTURED_OUTPUT_INVALID',
    });
    expect(inference.infer).toHaveBeenCalledTimes(2);
    expect(prisma.aiEmailClassification.createMany).not.toHaveBeenCalled();
  });

  it('does not repair a provider failure', async () => {
    const { service, inference, prisma } = fixture();
    inference.infer.mockRejectedValue(
      new StructuredInferenceProviderError(true, 'Groq', 'qwen/qwen3.8-27b', 1),
    );

    await service.processPendingForUser('user-1');

    expect(inference.infer).toHaveBeenCalledTimes(1);
    expect(prisma.aiEmailClassification.createMany).not.toHaveBeenCalled();
    expect(prisma.aiEmailMessage.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ processingStatus: 'REVIEW_REQUIRED' }),
      }),
    );
  });
});
