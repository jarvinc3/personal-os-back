import { ConflictException } from '@nestjs/common';
import { AiKnowledgeService } from './ai-knowledge.service';

type StoredKnowledge = Record<string, unknown>;

type FixtureOptions = {
  priorKnowledge?: StoredKnowledge[];
  reverts?: Array<{
    sequence: bigint;
    verdict: 'CONFIRMED' | 'REJECTED';
    structuralKeys: Array<{ knowledgeType: string; knowledgeKey: string }>;
  }>;
};

function makeFixture(options: FixtureOptions = {}) {
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
    normalizerVersion: null,
  }));
  let stored: StoredKnowledge[] = options.priorKnowledge ?? [];
  let adminDecisions = options.reverts ?? [];
  let verificationSequence = 4n;
  let runCount = 0;
  const tx = {
    aiKnowledgeObservation: {
      aggregate: jest.fn().mockResolvedValue({ _max: { sequence: null } }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    aiHumanVerification: {
      aggregate: jest.fn(() =>
        Promise.resolve({ _max: { sequence: verificationSequence } }),
      ),
      findMany: jest.fn(({ where }: { where: { targetType: string } }) =>
        Promise.resolve(
          where.targetType === 'EMAIL_MESSAGE' ? verifications : adminDecisions,
        ),
      ),
      create: jest.fn(
        ({ data: verificationInput }: { data: StoredKnowledge }) => {
          verificationSequence += 1n;
          const payload = verificationInput as {
            verdict: 'CONFIRMED' | 'REJECTED';
            structuralKeys: unknown;
          };
          adminDecisions = [
            ...adminDecisions,
            {
              sequence: verificationSequence,
              verdict: payload.verdict,
              structuralKeys: payload.structuralKeys as Array<{
                knowledgeType: string;
                knowledgeKey: string;
              }>,
            },
          ];
          return Promise.resolve({
            ...verificationInput,
            sequence: verificationSequence,
          });
        },
      ),
    },
    aiConsentEvent: {
      aggregate: jest.fn().mockResolvedValue({ _max: { sequence: 1n } }),
    },
    aiDataset: {
      upsert: jest.fn().mockResolvedValue({ id: 'dataset-1' }),
    },
    aiKnowledge: {
      findMany: jest.fn(() => Promise.resolve(stored)),
      update: jest.fn(
        ({
          where,
          data: updates,
        }: {
          where: { id: string };
          data: StoredKnowledge;
        }) => {
          stored = stored.map((row) =>
            row.id === where.id ? { ...row, ...updates } : row,
          );
          return Promise.resolve(stored.find((row) => row.id === where.id));
        },
      ),
      deleteMany: jest.fn(() => {
        stored = [];
        return Promise.resolve({ count: 0 });
      }),
      createMany: jest.fn(({ data: rows }: { data: StoredKnowledge[] }) => {
        stored = rows.map((row, index) => ({
          ...row,
          id: row.id ?? `item-${index}`,
        }));
        return Promise.resolve({ count: stored.length });
      }),
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
      create: jest.fn(({ data: run }: { data: StoredKnowledge }) =>
        Promise.resolve({ ...run, id: `run-${++runCount}` }),
      ),
    },
  };
  const prisma = {
    aiKnowledge: {
      findFirst: jest.fn(
        ({ where }: { where: Record<string, string | undefined> }) =>
          Promise.resolve(
            stored.find(
              (row) =>
                (where.id !== undefined && row.id === where.id) ||
                (where.scope === row.scope &&
                  where.knowledgeType === row.knowledgeType &&
                  where.knowledgeKey === row.knowledgeKey),
            ),
          ),
      ),
    },
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
  return { service, tx, getStored: () => stored };
}

function priorGlobalRow(): StoredKnowledge {
  const date = new Date('2026-10-20T00:00:00Z');
  return {
    id: 'prior-global',
    scope: 'GLOBAL',
    userId: null,
    knowledgeType: 'EMAIL_DOMAIN',
    knowledgeKey: 'other.com',
    state: 'STABLE',
    payload: { label: { semanticType: 'FIN_TRANSACTION' } },
    messagesSeen: 2,
    rejectedMessages: 0,
    distinctUsers: 2,
    humanVerifiedCount: 2,
    promotedBy: 'AUTO',
    projectorVersion: 'old-projector',
    policyVersion: 'old-policy',
    normalizerVersion: 'old-normalizer',
    sanitizerVersion: 'old-sanitizer',
    firstSeenAt: date,
    lastSeenAt: date,
    updatedAt: date,
  };
}

describe('AiKnowledgeService rebuild', () => {
  it('mantiene la misma proyección al borrarla y reconstruirla desde la misma evidencia', async () => {
    const { service, tx, getStored } = makeFixture();
    const first = await service.rebuild('admin-1');
    const firstProjection = structuredClone(getStored());
    const second = await service.rebuild('admin-1');
    expect(getStored()).toEqual(firstProjection);
    expect(first.items).toBe(second.items);
    expect(
      getStored().filter(
        (row) => row.scope === 'GLOBAL' && row.state === 'STABLE',
      ),
    ).toHaveLength(2);
    expect(tx.aiKnowledge.deleteMany).toHaveBeenCalledTimes(2);
  });

  it('promueve una fila GLOBAL en revisión y el rebuild conserva la promoción', async () => {
    const pending = {
      ...priorGlobalRow(),
      id: 'pending-global',
      state: 'REVIEW_REQUIRED',
      promotedBy: null,
    };
    const { service, tx, getStored } = makeFixture({
      priorKnowledge: [pending],
    });

    const promoted = await service.promote('admin-1', 'pending-global');

    expect(tx.aiHumanVerification.create).toHaveBeenCalled();
    expect(promoted).toMatchObject({ state: 'STABLE', promotedBy: 'ADMIN' });
    expect(
      getStored().find((row) => row.knowledgeKey === 'other.com'),
    ).toMatchObject({ state: 'STABLE', promotedBy: 'ADMIN' });
  });

  it('rechaza promover una fila GLOBAL que no está en revisión', async () => {
    const { service } = makeFixture({ priorKnowledge: [priorGlobalRow()] });

    await expect(
      service.promote('admin-1', 'prior-global'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('mantiene bloqueado un GLOBAL sin evidencia tras una reversión ADMIN', async () => {
    const { service, getStored } = makeFixture({
      priorKnowledge: [priorGlobalRow()],
      reverts: [
        {
          sequence: 4n,
          verdict: 'REJECTED',
          structuralKeys: [
            { knowledgeType: 'EMAIL_DOMAIN', knowledgeKey: 'other.com' },
          ],
        },
      ],
    });
    await service.rebuild('admin-1');
    expect(
      getStored().find((row) => row.knowledgeKey === 'other.com'),
    ).toMatchObject({
      scope: 'GLOBAL',
      state: 'BLOCKED',
      promotedBy: null,
      messagesSeen: 0,
    });
  });
});
