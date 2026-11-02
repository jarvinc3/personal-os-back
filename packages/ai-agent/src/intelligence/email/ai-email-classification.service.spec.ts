import type { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';
import type { PrismaService } from '@personal-os/database';
import type { InferenceCompletionPort } from '@personal-os/contracts';
import { AiEmailClassificationService } from './ai-email-classification.service';

function fixture(
  options: {
    body?: string;
    knowledge?: unknown[];
    role?: string;
    budgetAvailable?: boolean;
    inferenceValue?: unknown;
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
  };
  const prisma = {
    aiEmailMessage: {
      findMany: jest.fn().mockResolvedValue([{ id: 'message-1' }]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn().mockResolvedValue({
        id: 'message-1',
        fromAddress: 'notice@example.com',
        subject: 'Notice',
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
  return {
    service: new AiEmailClassificationService(
      prisma as unknown as PrismaService,
      inference as unknown as InferenceCompletionPort,
      config as unknown as ConfigService<Env, true>,
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
});
