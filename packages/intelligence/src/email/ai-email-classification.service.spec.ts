import type { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';
import type { ModuleSettingsReader } from '@personal-os/contracts';
import type { EmailProductHints } from '@personal-os/contracts';
import type { PrismaService } from '@personal-os/database';
import {
  StructuredInferenceOutputError,
  StructuredInferenceProviderError,
} from '@personal-os/contracts';
import type { InferenceCompletionPort } from '@personal-os/contracts';
import { AiEmailClassificationService } from './ai-email-classification.service';
import { knowledgeKeys } from '../knowledge/knowledge-normalizer';
import {
  estimateClassificationTokens,
  type EmailClassificationLimits,
} from './email-classification-limits';

const LIMITS: EmailClassificationLimits = {
  classificationsPerMinute: 20,
  initialBudget: 500,
  dailyTokenBudget: 320_000,
  dailyCostLimitUsd: 5,
  costAlertRatio: 0.8,
  maxContentChars: 24_000,
  maxSubjectChars: 1_000,
  maxSenderChars: 320,
  bankSenderDomains: ['bhd.com.do', 'popular.com.do'],
};

function fixture(
  options: {
    body?: string;
    messageId?: string;
    fromAddress?: string;
    fromDomain?: string;
    subject?: string;
    receivedAt?: Date;
    knowledge?: unknown[];
    role?: string;
    budgetAvailable?: boolean;
    rateSlotAvailable?: boolean;
    costReservationAvailable?: boolean;
    inferenceValue?: unknown;
    inferenceUsage?: { inputTokens?: number; outputTokens?: number };
    inferenceFallbackCount?: number;
    inferenceCostUsd?: number | null;
    reviewSettings?: {
      reviewConfidenceThreshold?: number;
      acceptVerifiedSenders?: boolean;
    };
    productHints?: EmailProductHints;
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
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: options.messageId ?? 'message-1' }]),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn().mockResolvedValue({
        id: options.messageId ?? 'message-1',
        receivedAt: options.receivedAt ?? new Date('2026-10-01T12:00:00Z'),
        providerThreadId: 'thread-1',
        fromAddress: options.fromAddress ?? 'alertas@bhd.com.do',
        fromDomain: options.fromDomain ?? 'bhd.com.do',
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
    aiEmailTokenBudget: {
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest
        .fn()
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({
          count: options.budgetAvailable === false ? 0 : 1,
        }),
    },
    aiEmailConnection: {
      findUnique: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    aiEmailDailyCost: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({ costUsd: 0, alertedAt: null }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    aiEmailClassificationMinute: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $queryRaw: jest.fn((strings: TemplateStringsArray) => {
      const sql = strings.join(' ? ');
      if (sql.includes('ai_email_classification_minutes')) {
        return Promise.resolve(
          options.rateSlotAvailable === false ? [] : [{ calls: 1 }],
        );
      }
      return Promise.resolve(
        options.costReservationAvailable === false
          ? []
          : [{ cost_usd: 0.02, alerted_at: null }],
      );
    }),
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
      fallbackCount: options.inferenceFallbackCount ?? 0,
      inputTokens: options.inferenceUsage?.inputTokens ?? null,
      outputTokens: options.inferenceUsage?.outputTokens ?? null,
      costUsd: options.inferenceCostUsd ?? null,
    }),
  };
  const config = {
    get: jest.fn((key: string) => {
      const values: Record<string, unknown> = {
        AI_EMAIL_CLASSIFICATIONS_PER_MINUTE: LIMITS.classificationsPerMinute,
        AI_EMAIL_INITIAL_BUDGET: LIMITS.initialBudget,
        AI_EMAIL_DAILY_TOKEN_BUDGET: LIMITS.dailyTokenBudget,
        AI_EMAIL_DAILY_COST_LIMIT_USD: LIMITS.dailyCostLimitUsd,
        AI_EMAIL_COST_ALERT_RATIO: LIMITS.costAlertRatio,
        AI_EMAIL_MAX_CONTENT_CHARS: LIMITS.maxContentChars,
        AI_EMAIL_MAX_SUBJECT_CHARS: LIMITS.maxSubjectChars,
        AI_EMAIL_MAX_SENDER_CHARS: LIMITS.maxSenderChars,
        AI_EMAIL_BANK_SENDER_DOMAINS: LIMITS.bankSenderDomains,
      };
      return values[key];
    }),
  };
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
  const notifications = { submit: jest.fn().mockResolvedValue(undefined) };
  return {
    service: new AiEmailClassificationService(
      prisma as unknown as PrismaService,
      inference as unknown as InferenceCompletionPort,
      config as unknown as ConfigService<Env, true>,
      moduleSettings as unknown as ModuleSettingsReader | undefined,
      options.productHints
        ? {
            readEmailProductHints: jest
              .fn()
              .mockResolvedValue(options.productHints),
          }
        : undefined,
      notifications,
    ),
    prisma,
    inference,
    notifications,
  };
}

/**
 * Correo del piloto que cae en la muestra de auditoría de recall: el hash de su
 * id es múltiplo de 100 y una etiqueta conocida lo marca como irrelevante.
 */
const AUDIT_SAMPLE_MESSAGE_ID = 'audit-sample-93';

function auditSampleFixture() {
  return {
    messageId: AUDIT_SAMPLE_MESSAGE_ID,
    role: 'ADMIN',
    fromDomain: 'bhd.com.do',
    subject: 'BHD Notificación de Transacciones',
    body: 'BHD Notificación de Transacciones Visa Premia # 0000 Detalle de Transacciones Fecha Moneda Monto Comercio Estado Tipo 06/11/2026 11:44 am RD $151.30 UBER*RIDES Aprobada Compra',
    receivedAt: new Date('2026-11-06T15:45:00Z'),
    knowledge: [
      {
        id: 'k1',
        knowledgeType: 'EMAIL_TEMPLATE',
        knowledgeKey: 'bhd',
        scope: 'USER',
        payload: {
          label: {
            relevance: false,
            semanticType: 'MARKETING',
            routes: [],
          },
        },
      },
    ],
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
    expect(prisma.aiEmailTokenBudget.upsert).not.toHaveBeenCalled();
    expect(prisma.aiEmailTokenBudget.updateMany).not.toHaveBeenCalled();
  }

  it('previews a classification with the model and writes no classification rows', async () => {
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

  it('previews a recognized BHD card alert without calling the model', async () => {
    const { service, inference, prisma } = fixture({
      fromDomain: 'bhd.com.do',
      subject: 'BHD Notificación de Transacciones',
      body: 'BHD Notificación de Transacciones Visa Premia # 0000 Detalle de Transacciones Fecha Moneda Monto Comercio Estado Tipo 06/11/2026 11:44 am RD $151.30 UBER*RIDES Aprobada Compra',
      receivedAt: new Date('2026-11-06T15:45:00Z'),
    });

    const preview = await service.previewClassification({
      userId: 'user-1',
      messageId: 'message-1',
    });

    expect(preview).toMatchObject({
      kind: 'classified',
      method: 'DETERMINISTIC',
      provider: null,
      model: null,
      classification: {
        semanticType: 'FIN_TRANSACTION',
        confidence: 0.99,
        transaction: {
          amount: 151.3,
          currency: 'DOP',
          direction: 'DEBIT',
          movementClass: 'PURCHASE',
        },
      },
    });
    expect(inference.infer).not.toHaveBeenCalled();
    expectNoWrites(prisma);
  });

  it('decides a BHD transfer between own products with the products of the owner', async () => {
    const { service, inference } = fixture({
      fromDomain: 'bhd.com.do',
      subject: 'Transacciones entre mis productos',
      body: 'Producto origen: XXXXXXX0016 Producto destino: XXXXXXXXXXXX6506 Descripción: Pago de saldo al corte Monto: RD$ 1,000.00 Número de confirmación: M01-1111-2222-3333-4 Fecha y hora de la transacción: 06/11/2026 - 11:12 AM',
      receivedAt: new Date('2026-11-06T15:12:58Z'),
      productHints: { creditCardLast4: ['6506'], ownProductLast4: ['0016'] },
    });

    const preview = await service.previewClassification({
      userId: 'user-1',
      messageId: 'message-1',
    });

    expect(preview).toMatchObject({
      method: 'DETERMINISTIC',
      classification: {
        transaction: {
          movementClass: 'CARD_PAYMENT',
          direction: 'DEBIT',
          accountNumberLast4: '0016',
          last4: '6506',
        },
      },
    });
    expect(inference.infer).not.toHaveBeenCalled();
  });

  it('keeps the audit measurement failure out of the classification', async () => {
    const { service, inference } = fixture(auditSampleFixture());
    inference.infer.mockRejectedValue(new Error('provider down'));

    const preview = await service.previewClassification({
      userId: 'user-1',
      messageId: AUDIT_SAMPLE_MESSAGE_ID,
    });

    expect(inference.infer).toHaveBeenCalledTimes(1);
    expect(preview).toMatchObject({
      kind: 'classified',
      method: 'DETERMINISTIC',
      classification: { semanticType: 'FIN_TRANSACTION' },
    });
  });

  it('classifies a recognized BHD format when the audit measurement has no budget', async () => {
    const { service, inference, prisma } = fixture({
      ...auditSampleFixture(),
      budgetAvailable: false,
    });

    await service.processPendingForUser('user-1');

    expect(inference.infer).not.toHaveBeenCalled();
    expect(prisma.aiEmailClassification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            decisionPath: 'DETERMINISTIC',
            semanticType: 'FIN_TRANSACTION',
          }),
        ],
      }),
    );
  });

  it('still asks the model for a BHD email outside the fixed formats', async () => {
    const { service, inference } = fixture({
      fromDomain: 'bhd.com.do',
      subject: 'Modo Plus Friday activado',
      body: 'Solicita tu Tarjeta Preaprobada BHD y conoce las ofertas del mes.',
    });

    await service.previewClassification({
      userId: 'user-1',
      messageId: 'message-1',
    });

    expect(inference.infer).toHaveBeenCalledTimes(1);
  });

  it('keeps the deterministic classification in an audit sample and only measures with the model', async () => {
    const { service, inference } = fixture(auditSampleFixture());

    const preview = await service.previewClassification({
      userId: 'user-1',
      messageId: AUDIT_SAMPLE_MESSAGE_ID,
    });

    expect(inference.infer).toHaveBeenCalledTimes(1);
    expect(preview).toMatchObject({
      method: 'DETERMINISTIC',
      provider: null,
      model: null,
      auditSample: true,
      classification: {
        semanticType: 'FIN_TRANSACTION',
        transaction: { movementClass: 'PURCHASE', direction: 'DEBIT' },
      },
    });
  });

  it('discards a non-bank sender without a deterministic classification', async () => {
    const { service, inference, prisma } = fixture({
      fromAddress: 'boletin@example.com',
      fromDomain: 'example.com',
      subject: 'Novedades del mes',
      body: 'Conoce las novedades de esta semana.',
    });

    await service.processPendingForUser('user-1');

    expect(inference.infer).not.toHaveBeenCalled();
    expect(prisma.aiEmailMessage.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'message-1',
        userId: 'user-1',
        processingStatus: 'CLASSIFYING',
      },
      data: { processingStatus: 'DISCARDED', classificationStartedAt: null },
    });
  });

  it('does not measure an audit sample outside the bank sender list', async () => {
    const sender = 'noticias@example.com';
    const subject = 'BHD Notificación de Transacciones';
    const templateKey = knowledgeKeys(sender, subject).find(
      ({ knowledgeType }) => knowledgeType === 'EMAIL_TEMPLATE',
    )?.knowledgeKey;
    if (!templateKey) {
      throw new Error('Expected a normalized template knowledge key');
    }
    const knowledge = [
      {
        id: 'k-step',
        knowledgeType: 'EMAIL_TEMPLATE',
        knowledgeKey: templateKey,
        scope: 'USER',
        payload: {
          label: { relevance: false, semanticType: 'MARKETING', routes: [] },
        },
      },
    ];
    const base = {
      messageId: AUDIT_SAMPLE_MESSAGE_ID,
      role: 'ADMIN',
      fromAddress: sender,
      subject,
      body: auditSampleFixture().body,
      knowledge,
    };

    const nonBank = fixture({ ...base, fromDomain: 'example.com' });
    await nonBank.service.processPendingForUser('user-1');
    expect(nonBank.inference.infer).not.toHaveBeenCalled();

    const bank = fixture({ ...base, fromDomain: 'bhd.com.do' });
    await bank.service.processPendingForUser('user-1');
    expect(bank.inference.infer).toHaveBeenCalledTimes(1);
  });

  it('reports a paused global cap in the preview without calling the model', async () => {
    const { service, inference, prisma } = fixture();
    prisma.aiEmailDailyCost.findUnique = jest
      .fn()
      .mockResolvedValue({ costUsd: 5 });

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
      rateLimited: false,
    });
  });

  it('reports no model call for a deterministic classification', async () => {
    const { service } = fixture({
      body: 'Your verification code is 123456.',
    });

    await expect(service.processPendingForUser('user-1')).resolves.toEqual({
      processed: 1,
      modelCalls: 0,
      rateLimited: false,
    });
  });
});

describe('AiEmailClassificationService shared limits', () => {
  function rawQueries(
    prisma: ReturnType<typeof fixture>['prisma'],
    table: string,
  ) {
    return (prisma.$queryRaw as jest.Mock).mock.calls.filter(([sql]) =>
      String(sql).includes(table),
    );
  }

  it('reserves one minute slot per model classification', async () => {
    const { service, prisma } = fixture();

    await service.processPendingForUser('user-1');

    expect(rawQueries(prisma, 'ai_email_classification_minutes')).toHaveLength(
      1,
    );
  });

  it('stops the batch when the minute counter is full', async () => {
    const { service, inference, prisma } = fixture({
      rateSlotAvailable: false,
    });

    await expect(service.processPendingForUser('user-1')).resolves.toEqual({
      processed: 0,
      modelCalls: 0,
      rateLimited: true,
    });
    expect(inference.infer).not.toHaveBeenCalled();
    expect(prisma.aiEmailMessage.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: { processingStatus: 'QUEUED', classificationStartedAt: null },
      }),
    );
  });

  it('reports the minute limit in the preview without calling the model', async () => {
    const { service, inference } = fixture({ rateSlotAvailable: false });

    await expect(
      service.previewClassification({
        userId: 'user-1',
        messageId: 'message-1',
      }),
    ).resolves.toEqual({ kind: 'unavailable', reason: 'RATE_LIMITED' });
    expect(inference.infer).not.toHaveBeenCalled();
  });

  it('does not call the model when the max cost does not fit under the daily cap', async () => {
    const { service, inference, prisma } = fixture({
      costReservationAvailable: false,
    });

    await service.processPendingForUser('user-1');

    expect(inference.infer).not.toHaveBeenCalled();
    expect(prisma.aiEmailMessage.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: { processingStatus: 'QUEUED', classificationStartedAt: null },
      }),
    );
    expect(prisma.aiEmailTokenBudget.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: {
          tokens: {
            decrement: estimateClassificationTokens({
              limits: LIMITS,
              contentChars: 'A regular email.'.length,
            }),
          },
        },
      }),
    );
    expect(prisma.aiEmailDailyCost.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ pausedAt: null }),
      }),
    );
  });

  it('settles the reserved cost down to the cost the gateway reported', async () => {
    const { service, prisma } = fixture({
      inferenceUsage: { inputTokens: 1000, outputTokens: 200 },
      inferenceCostUsd: 0.00032,
    });

    await service.processPendingForUser('user-1');

    expect(prisma.aiEmailDailyCost.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { costUsd: { decrement: 0.12968 } },
      }),
    );
  });

  it('keeps the full reservation when the gateway could not estimate the cost', async () => {
    const { service, prisma } = fixture({ inferenceCostUsd: null });

    await service.processPendingForUser('user-1');

    expect(prisma.aiEmailDailyCost.updateMany).not.toHaveBeenCalled();
  });

  it('reserves the daily cost in the preview without consuming the daily quota', async () => {
    const { service, prisma } = fixture();

    await service.previewClassification({
      userId: 'user-1',
      messageId: 'message-1',
    });

    expect(rawQueries(prisma, 'ai_email_daily_costs')).toHaveLength(1);
    expect(prisma.aiEmailTokenBudget.updateMany).not.toHaveBeenCalled();
  });

  it('settles the reserved tokens down to the tokens the gateway reported', async () => {
    const { service, prisma } = fixture({
      inferenceUsage: { inputTokens: 1000, outputTokens: 200 },
      inferenceCostUsd: 0.00032,
    });

    await service.processPendingForUser('user-1');

    expect(prisma.aiEmailTokenBudget.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: {
          tokens: {
            decrement:
              estimateClassificationTokens({
                limits: LIMITS,
                contentChars: 'A regular email.'.length,
              }) - 1200,
          },
        },
      }),
    );
  });

  it('does not reserve tokens when the call comes from the initial budget', async () => {
    const { service, prisma } = fixture();
    prisma.aiEmailConnection.findUnique = jest
      .fn()
      .mockResolvedValue({ initialBudgetRemaining: 2 });
    prisma.aiEmailConnection.updateMany = jest
      .fn()
      .mockResolvedValue({ count: 1 });

    await service.processPendingForUser('user-1');

    expect(prisma.aiEmailTokenBudget.upsert).not.toHaveBeenCalled();
    expect(prisma.aiEmailConnection.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { initialBudgetRemaining: { decrement: 1 } },
      }),
    );
  });

  it('notifies the exhausted daily cap with the pending count', async () => {
    const { service, notifications, prisma } = fixture({
      budgetAvailable: false,
    });
    prisma.aiEmailMessage.count = jest.fn().mockResolvedValue(7);

    await service.processPendingForUser('user-1');

    expect(notifications.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        preferenceKey: 'ai.email.daily_budget',
        body: expect.stringContaining('quedan 7 correos'),
      }),
    );
  });

  it('settles the summed cost even after a provider fallback', async () => {
    const { service, prisma } = fixture({
      inferenceFallbackCount: 1,
      inferenceCostUsd: 0.0004,
    });

    await service.processPendingForUser('user-1');

    expect(prisma.aiEmailDailyCost.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { costUsd: { decrement: 0.1296 } },
      }),
    );
  });

  it('settles the cost of the repaired attempt together with the rejected one', async () => {
    const { service, inference, prisma } = fixture({
      inferenceCostUsd: 0.0004,
    });
    inference.infer.mockRejectedValueOnce(
      new StructuredInferenceOutputError(
        'Groq',
        'qwen/qwen3.8-27b',
        1,
        'SCHEMA_VALIDATION:transaction:invalid_type',
        0.0003,
      ),
    );

    await service.processPendingForUser('user-1');

    expect(inference.infer).toHaveBeenCalledTimes(2);
    expect(prisma.aiEmailDailyCost.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { costUsd: { decrement: 0.1293 } },
      }),
    );
  });

  it('keeps the full reservation when it had to repair a rejected output', async () => {
    const { service, inference, prisma } = fixture({
      inferenceCostUsd: 0.0004,
    });
    inference.infer.mockRejectedValueOnce(
      new StructuredInferenceOutputError(
        'Groq',
        'qwen/qwen3.8-27b',
        1,
        'SCHEMA_VALIDATION:transaction:invalid_type',
      ),
    );

    await service.processPendingForUser('user-1');

    expect(inference.infer).toHaveBeenCalledTimes(2);
    expect(prisma.aiEmailDailyCost.updateMany).not.toHaveBeenCalled();
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
