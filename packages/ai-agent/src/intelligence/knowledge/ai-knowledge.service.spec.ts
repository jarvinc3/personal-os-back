import { AiKnowledgeService } from './ai-knowledge.service';

describe('AiKnowledgeService rebuild', () => {
  it('mantiene la misma proyección al borrarla y reconstruirla desde la misma evidencia', async () => {
    const date = new Date('2026-10-25T00:00:00Z');
    const messages = ['u1', 'u2', 'u3'].map((userId, index) => ({
      id: `m${index + 1}`,
      userId,
      fromAddress: `alerts@bank.com`,
      subject: `Consumo RD$${index + 1},250`,
    }));
    const verifications = messages.map((message, index) => ({
      sequence: BigInt(index + 1),
      userId: message.userId,
      targetId: message.id,
      targetType: 'EMAIL_MESSAGE',
      verdict: 'CORRECTED',
      verifierRole: 'USER',
      correctedPayload: {
        semanticType: 'FIN_TRANSACTION',
        routes: ['FINANCE'],
        transaction: { kind: 'TRANSACTION', amount: index + 1250 },
      },
      isGroundTruth: false,
      createdAt: date,
      contributorTombstone: null,
      tombstoneEligible: false,
      structuralKeys: null,
      structuralPayload: null,
    }));
    let stored: Array<Record<string, unknown>> = [];
    let runCount = 0;
    const tx = {
      aiKnowledgeObservation: {
        aggregate: jest.fn().mockResolvedValue({ _max: { sequence: null } }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      aiHumanVerification: {
        aggregate: jest.fn().mockResolvedValue({ _max: { sequence: 3n } }),
        findMany: jest.fn(({ where }: { where: { targetType: string } }) =>
          Promise.resolve(
            where.targetType === 'EMAIL_MESSAGE' ? verifications : [],
          ),
        ),
      },
      aiConsentEvent: {
        aggregate: jest.fn().mockResolvedValue({ _max: { sequence: 1n } }),
      },
      aiDataset: {
        findUnique: jest.fn().mockResolvedValue({ id: 'dataset-1' }),
      },
      aiKnowledge: {
        findMany: jest.fn(() => Promise.resolve(stored)),
        deleteMany: jest.fn(() => {
          stored = [];
          return Promise.resolve({ count: 0 });
        }),
        createMany: jest.fn(
          ({ data }: { data: Array<Record<string, unknown>> }) => {
            stored = data.map((row, index) => ({
              ...row,
              id: row.id ?? `item-${index}`,
            }));
            return Promise.resolve({ count: stored.length });
          },
        ),
      },
      aiDatasetItem: {
        findMany: jest.fn().mockResolvedValue(
          messages.map((message) => ({
            sourceId: message.id,
            partition: 'TRAIN',
          })),
        ),
        createMany: jest.fn(),
      },
      aiEmailMessage: { findMany: jest.fn().mockResolvedValue(messages) },
      userAiSettings: {
        findMany: jest.fn().mockResolvedValue(
          messages.map((message) => ({
            userId: message.userId,
            contributeToGlobalKnowledge: true,
          })),
        ),
      },
      aiAnalysisRun: {
        create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...data, id: `run-${++runCount}` }),
        ),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (arg: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const config = {
      get: jest.fn((key: string) =>
        key === 'NODE_ENV' ? 'production' : undefined,
      ),
    };
    const service = new AiKnowledgeService(prisma as never, config as never);
    const first = await service.rebuild('admin-1');
    const firstProjection = structuredClone(stored);
    const second = await service.rebuild('admin-1');
    expect(stored).toEqual(firstProjection);
    expect(first.items).toBe(second.items);
    expect(
      stored.filter((row) => row.scope === 'GLOBAL' && row.state === 'STABLE'),
    ).toHaveLength(2);
    expect(tx.aiKnowledge.deleteMany).toHaveBeenCalledTimes(2);
  });
});
