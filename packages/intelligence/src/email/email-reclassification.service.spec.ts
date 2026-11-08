import { AiEmailReclassificationService } from './email-reclassification.service';

type StoredMessage = {
  id: string;
  userId: string;
  receivedAt: Date;
  fromAddress: string;
  subject: string;
  templateFingerprint: string | null;
  processingStatus: string;
  classification: Record<string, unknown> | null;
  classificationStartedAt: Date | null;
  classificationPath: string | null;
};

type StoredVerification = {
  userId: string;
  targetType: string;
  targetId: string;
};

type StoredClassification = {
  userId: string;
  messageId: string;
  route: string;
  decisionPath: string;
  knowledgeUsed: Array<Record<string, unknown>>;
  confidence: number;
};

type StoredPartition = {
  userId: string;
  sourceType: string;
  sourceId: string;
  partition: string;
};

type MessageInput = Partial<StoredMessage> & { id: string };

function financeLabel(amount: number) {
  return {
    relevance: true,
    semanticType: 'FIN_TRANSACTION',
    routes: ['FINANCE'],
    transaction: {
      kind: 'TRANSACTION',
      amount,
      currency: 'DOP',
      transactionDate: '2026-11-01T00:00:00.000Z',
      direction: 'DEBIT',
      last4: '4821',
      movementClass: 'PURCHASE',
    },
    confidence: 0.4,
  };
}

function makeFixture({
  messages,
  verifications = [],
  partitions = [],
  classifications = [],
}: {
  messages: MessageInput[];
  verifications?: StoredVerification[];
  partitions?: StoredPartition[];
  classifications?: StoredClassification[];
}) {
  const state = {
    messages: messages.map((message, index) => ({
      userId: 'user-1',
      receivedAt: new Date(Date.UTC(2026, 10, 1, 0, index)),
      fromAddress: 'alertas@banco.com',
      subject: 'Consumo RD$1,250 en tienda',
      templateFingerprint: 'fp-1',
      processingStatus: 'REVIEW_REQUIRED',
      classification: null,
      classificationStartedAt: null,
      classificationPath: null,
      ...message,
    })) as StoredMessage[],
    verifications: [...verifications],
    partitions: [...partitions],
    classifications: [...classifications],
    signals: [] as Array<Record<string, unknown>>,
    signalEvidence: [] as Array<Record<string, unknown>>,
    outbox: [] as Array<Record<string, unknown>>,
    runs: [] as Array<Record<string, unknown>>,
  };

  const matchesWhere = (
    message: StoredMessage,
    where: Record<string, unknown>,
  ) => {
    if (where.userId !== undefined && message.userId !== where.userId) {
      return false;
    }
    if (
      where.fromAddress !== undefined &&
      message.fromAddress !== where.fromAddress
    ) {
      return false;
    }
    if (
      where.templateFingerprint !== undefined &&
      message.templateFingerprint !== where.templateFingerprint
    ) {
      return false;
    }
    if (where.fromDomain !== undefined) {
      const domain = message.fromAddress.split('@')[1];
      if (domain !== where.fromDomain) {
        return false;
      }
    }
    const status = where.processingStatus as
      string | { in?: string[] } | undefined;
    if (typeof status === 'string' && message.processingStatus !== status) {
      return false;
    }
    if (
      status &&
      typeof status === 'object' &&
      status.in &&
      !status.in.includes(message.processingStatus)
    ) {
      return false;
    }
    const id = where.id as string | { in?: string[] } | undefined;
    if (typeof id === 'string' && message.id !== id) {
      return false;
    }
    if (id && typeof id === 'object' && id.in && !id.in.includes(message.id)) {
      return false;
    }
    const startedAt = where.classificationStartedAt as Date | null | undefined;
    if (startedAt !== undefined) {
      const messageStartedAt = message.classificationStartedAt;
      if (startedAt === null) {
        if (messageStartedAt !== null) {
          return false;
        }
      } else if (
        !messageStartedAt ||
        messageStartedAt.getTime() !== startedAt.getTime()
      ) {
        return false;
      }
    }
    return true;
  };

  const snapshot = () => ({
    messages: state.messages.map((message) => ({ ...message })),
    classifications: [...state.classifications],
    signals: [...state.signals],
    signalEvidence: [...state.signalEvidence],
    outbox: [...state.outbox],
  });

  const prisma = {
    aiEmailMessage: {
      findMany: jest.fn(
        (command: { where: Record<string, unknown>; take?: number }) => {
          const found = state.messages.filter((message) =>
            matchesWhere(message, command.where),
          );
          return Promise.resolve(
            command.take ? found.slice(0, command.take) : found,
          );
        },
      ),
      findFirst: jest.fn((command: { where: Record<string, unknown> }) =>
        Promise.resolve(
          state.messages.find((message) =>
            matchesWhere(message, command.where),
          ) ?? null,
        ),
      ),
      updateManyAndReturn: jest.fn(
        ({
          where,
          data: patch,
        }: {
          where: Record<string, unknown>;
          data: object;
        }) => {
          const found = state.messages.filter((message) =>
            matchesWhere(message, where),
          );
          for (const message of found) {
            Object.assign(message, patch);
          }
          return Promise.resolve(found.map((message) => ({ ...message })));
        },
      ),
      updateMany: jest.fn(
        ({
          where,
          data: patch,
        }: {
          where: Record<string, unknown>;
          data: object;
        }) => {
          const found = state.messages.filter((message) =>
            matchesWhere(message, where),
          );
          for (const message of found) {
            Object.assign(message, patch);
          }
          return Promise.resolve({ count: found.length });
        },
      ),
    },
    aiHumanVerification: {
      findMany: jest.fn(
        (command: {
          where: { userId: string; targetId?: { in?: string[] } };
        }) =>
          Promise.resolve(
            state.verifications.filter(
              (verification) =>
                verification.userId === command.where.userId &&
                (!command.where.targetId?.in ||
                  command.where.targetId.in.includes(verification.targetId)),
            ),
          ),
      ),
      aggregate: jest.fn().mockResolvedValue({ _max: { sequence: null } }),
    },
    aiDatasetItem: {
      findMany: jest.fn(
        (command: {
          where: { userId: string; sourceId?: { in?: string[] } };
        }) =>
          Promise.resolve(
            state.partitions.filter(
              (partition) =>
                partition.userId === command.where.userId &&
                (!command.where.sourceId?.in ||
                  command.where.sourceId.in.includes(partition.sourceId)),
            ),
          ),
      ),
    },
    aiDataset: {
      upsert: jest.fn().mockResolvedValue({ id: 'dataset-1' }),
    },
    aiKnowledgeObservation: {
      aggregate: jest.fn().mockResolvedValue({ _max: { sequence: null } }),
    },
    aiConsentEvent: {
      aggregate: jest.fn().mockResolvedValue({ _max: { sequence: null } }),
    },
    aiAnalysisRun: {
      create: jest.fn(
        ({ data: runInput }: { data: Record<string, unknown> }) => {
          const run = { ...runInput, id: `run-${state.runs.length + 1}` };
          state.runs.push(run);
          return Promise.resolve({ id: run.id });
        },
      ),
      update: jest.fn(
        ({
          where,
          data: runPatch,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const run = state.runs.find((row) => row.id === where.id);
          if (run) {
            Object.assign(run, runPatch);
          }
          return Promise.resolve(run);
        },
      ),
    },
    aiEmailClassification: {
      findMany: jest.fn(
        (command: {
          where: {
            userId: string;
            knowledgeUsed?: { array_contains?: Array<Record<string, unknown>> };
          };
        }) =>
          Promise.resolve(
            state.classifications.filter(
              (classification) =>
                classification.userId === command.where.userId &&
                (!command.where.knowledgeUsed?.array_contains ||
                  command.where.knowledgeUsed.array_contains.every((wanted) =>
                    classification.knowledgeUsed.some((used) =>
                      Object.entries(wanted).every(
                        ([key, value]) => used[key] === value,
                      ),
                    ),
                  )),
            ),
          ),
      ),
      deleteMany: jest.fn(
        (command: {
          where: { userId: string; messageId: { in: string[] } };
        }) => {
          const before = state.classifications.length;
          state.classifications = state.classifications.filter(
            (classification) =>
              classification.userId !== command.where.userId ||
              !command.where.messageId.in.includes(classification.messageId),
          );
          return Promise.resolve({
            count: before - state.classifications.length,
          });
        },
      ),
      createMany: jest.fn(
        ({ data: rows }: { data: StoredClassification[] }) => {
          for (const row of rows) {
            const index = state.classifications.findIndex(
              (stored) =>
                stored.messageId === row.messageId &&
                stored.route === row.route,
            );
            if (index >= 0) {
              state.classifications[index] = row;
              continue;
            }
            state.classifications.push(row);
          }
          return Promise.resolve({ count: rows.length });
        },
      ),
    },
    aiSignal: {
      createMany: jest.fn(
        ({ data: rows }: { data: Array<Record<string, unknown>> }) => {
          let count = 0;
          for (const row of rows) {
            const exists = state.signals.some(
              (stored) =>
                stored.userId === row.userId &&
                stored.deduplicationKey === row.deduplicationKey,
            );
            if (exists) {
              continue;
            }
            state.signals.push(row);
            count += 1;
          }
          return Promise.resolve({ count });
        },
      ),
    },
    aiSignalEvidence: {
      createMany: jest.fn(
        ({ data: rows }: { data: Array<Record<string, unknown>> }) => {
          let count = 0;
          for (const row of rows) {
            const exists = state.signalEvidence.some(
              (stored) =>
                stored.signalId === row.signalId &&
                stored.sourceId === row.sourceId,
            );
            if (exists) {
              continue;
            }
            state.signalEvidence.push(row);
            count += 1;
          }
          return Promise.resolve({ count });
        },
      ),
    },
    domainEventOutbox: {
      createMany: jest.fn(
        ({ data: rows }: { data: Array<Record<string, unknown>> }) => {
          let count = 0;
          for (const row of rows) {
            const exists = state.outbox.some(
              (stored) => stored.eventId === row.eventId,
            );
            if (exists) {
              continue;
            }
            state.outbox.push(row);
            count += 1;
          }
          return Promise.resolve({ count });
        },
      ),
    },
    $transaction: jest.fn(
      (input: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)) => {
        if (typeof input !== 'function') {
          return Promise.all(input);
        }
        const before = snapshot();
        return input(prisma).catch((error: unknown) => {
          Object.assign(state, before);
          throw error;
        });
      },
    ),
  };

  return { prisma, state, matchesWhere };
}

function trainPartitions(ids: readonly string[]): StoredPartition[] {
  return ids.map((sourceId) => ({
    userId: 'user-1',
    sourceType: 'EMAIL_MESSAGE',
    sourceId,
    partition: 'TRAIN',
  }));
}

const correctedFinanceLabel = {
  relevance: true,
  semanticType: 'FIN_TRANSACTION',
  routes: ['FINANCE'],
  transaction: { kind: 'TRANSACTION' },
};

describe('AiEmailReclassificationService', () => {
  it('reclassifies the sender history, preserves the verified message and skips HOLDOUT', async () => {
    const { prisma, state } = makeFixture({
      messages: [
        {
          id: 'm1',
          processingStatus: 'PROCESSED',
          classification: financeLabel(1250),
        },
        { id: 'm2', classification: financeLabel(3400) },
        { id: 'm3', classification: null },
        {
          id: 'm4',
          templateFingerprint: 'fp-holdout',
          classification: financeLabel(99),
        },
        {
          id: 'm5',
          fromAddress: 'otro@otro.com',
          classification: financeLabel(10),
        },
        {
          id: 'm6',
          templateFingerprint: 'fp-2',
          classification: financeLabel(5000),
        },
      ],
      verifications: [
        { userId: 'user-1', targetType: 'EMAIL_MESSAGE', targetId: 'm1' },
      ],
      partitions: [
        ...trainPartitions(['m1', 'm2', 'm3', 'm5', 'm6']),
        {
          userId: 'user-1',
          sourceType: 'EMAIL_MESSAGE',
          sourceId: 'm4',
          partition: 'HOLDOUT',
        },
      ],
    });
    const service = new AiEmailReclassificationService(prisma as never);

    await expect(
      service.reclassifyAfterMessageVerification({
        userId: 'user-1',
        messageId: 'm1',
        correctedLabel: correctedFinanceLabel,
      }),
    ).resolves.toEqual({ requeued: 2 });

    const byId = new Map(
      state.messages.map((message) => [message.id, message]),
    );
    expect(byId.get('m1')).toMatchObject({
      processingStatus: 'PROCESSED',
      classificationPath: null,
    });
    expect(byId.get('m2')).toMatchObject({
      processingStatus: 'PROCESSED',
      classificationPath: 'KNOWLEDGE',
      classification: {
        semanticType: 'FIN_TRANSACTION',
        transaction: { amount: 3400, currency: 'DOP', last4: '4821' },
      },
    });
    expect(byId.get('m3')).toMatchObject({
      processingStatus: 'PROCESSED',
      classification: {
        semanticType: 'FIN_TRANSACTION',
        transaction: { kind: 'TRANSACTION' },
      },
    });
    expect(byId.get('m4')).toMatchObject({
      processingStatus: 'REVIEW_REQUIRED',
      classification: financeLabel(99),
    });
    expect(byId.get('m5')).toMatchObject({
      processingStatus: 'REVIEW_REQUIRED',
      classification: financeLabel(10),
    });
    expect(byId.get('m6')).toMatchObject({
      processingStatus: 'REVIEW_REQUIRED',
      classification: financeLabel(5000),
    });
    expect(state.verifications).toHaveLength(1);
    expect(
      state.classifications.find((row) => row.messageId === 'm2'),
    ).toMatchObject({
      route: 'FINANCE',
      decisionPath: 'KNOWLEDGE',
      knowledgeUsed: expect.arrayContaining([
        {
          knowledgeType: 'EMAIL_SENDER',
          knowledgeKey: 'alertas@banco.com',
          scope: 'USER',
        },
      ]),
    });
    expect(state.signals.map(({ id }) => id)).toEqual(['email-m2', 'email-m3']);
    expect(state.signals[0]).toMatchObject({
      type: 'FINANCE.TRANSACTION_DETECTED',
      domain: 'FINANCE',
      sourceId: 'm2',
      deduplicationKey: 'EMAIL_MESSAGE:m2',
      correlationKey: 'user-1:email:m2',
      payload: {
        semanticType: 'FIN_TRANSACTION',
        routes: ['FINANCE'],
        transaction: {
          kind: 'TRANSACTION',
          amount: 3400,
          currency: 'DOP',
          last4: '4821',
        },
      },
    });
    expect(state.signalEvidence[0]).toMatchObject({
      sourceId: 'm2',
      excerpt: { classificationPath: 'KNOWLEDGE', inferenceProvider: null },
    });
    expect(state.outbox.map(({ eventId }) => eventId)).toEqual([
      'ai.signal.routed:email-m2',
      'ai.signal.routed:email-m3',
    ]);
    expect(state.runs).toHaveLength(1);
    expect(state.runs[0]).toMatchObject({
      status: 'COMPLETED',
      metrics: { requeued: 2, skipped: 0 },
    });
  });

  it('is idempotent: a second pass replaces rows and never duplicates the signal', async () => {
    const { prisma, state } = makeFixture({
      messages: [{ id: 'm2', classification: financeLabel(3400) }],
      partitions: trainPartitions(['m2']),
    });
    const service = new AiEmailReclassificationService(prisma as never);

    await service.reclassifyAfterMessageVerification({
      userId: 'user-1',
      messageId: 'm2',
      correctedLabel: correctedFinanceLabel,
    });
    await service.reclassifyAfterMessageVerification({
      userId: 'user-1',
      messageId: 'm2',
      correctedLabel: correctedFinanceLabel,
    });

    expect(state.signals).toHaveLength(1);
    expect(state.signalEvidence).toHaveLength(1);
    expect(state.outbox).toHaveLength(1);
    expect(state.classifications).toHaveLength(1);
    expect(state.messages[0].processingStatus).toBe('PROCESSED');
  });

  it('reclassifies only the confirmed template and leaves other templates alone', async () => {
    const { prisma, state } = makeFixture({
      messages: [
        {
          id: 'g1',
          templateFingerprint: 'fp-1',
          classification: financeLabel(3400),
        },
        {
          id: 'g2',
          templateFingerprint: 'fp-1',
          classification: financeLabel(3400),
        },
        {
          id: 'g3',
          templateFingerprint: 'fp-2',
          classification: financeLabel(5000),
        },
      ],
      verifications: [
        { userId: 'user-1', targetType: 'EMAIL_MESSAGE', targetId: 'g1' },
      ],
      partitions: trainPartitions(['g1', 'g2', 'g3']),
    });
    const service = new AiEmailReclassificationService(prisma as never);

    await expect(
      service.reclassifyAfterReviewGroupVerification({
        userId: 'user-1',
        fromAddress: 'alertas@banco.com',
        templateFingerprint: 'fp-1',
        correctedLabel: correctedFinanceLabel,
      }),
    ).resolves.toEqual({ requeued: 1 });

    const byId = new Map(
      state.messages.map((message) => [message.id, message]),
    );
    expect(byId.get('g2')).toMatchObject({
      processingStatus: 'PROCESSED',
      classification: {
        relevance: true,
        semanticType: 'FIN_TRANSACTION',
        transaction: { amount: 3400, currency: 'DOP' },
      },
    });
    expect(byId.get('g3')).toMatchObject({
      processingStatus: 'REVIEW_REQUIRED',
      classification: financeLabel(5000),
    });
  });

  it('does not generalize a message or group without a template fingerprint', async () => {
    const { prisma, state } = makeFixture({
      messages: [
        {
          id: 'n1',
          templateFingerprint: null,
          classification: financeLabel(1250),
        },
        {
          id: 'n2',
          templateFingerprint: null,
          classification: financeLabel(3400),
        },
      ],
      partitions: trainPartitions(['n1', 'n2']),
    });
    const service = new AiEmailReclassificationService(prisma as never);

    await expect(
      service.reclassifyAfterMessageVerification({
        userId: 'user-1',
        messageId: 'n1',
        correctedLabel: correctedFinanceLabel,
      }),
    ).resolves.toEqual({ requeued: 0 });
    await expect(
      service.reclassifyAfterReviewGroupVerification({
        userId: 'user-1',
        fromAddress: 'alertas@banco.com',
        templateFingerprint: null,
        correctedLabel: correctedFinanceLabel,
      }),
    ).resolves.toEqual({ requeued: 0 });

    expect(state.messages.find(({ id }) => id === 'n2')).toMatchObject({
      processingStatus: 'REVIEW_REQUIRED',
      classification: financeLabel(3400),
    });
  });

  it('releases claimed messages when the chunk write fails and recovers on retry', async () => {
    const { prisma, state } = makeFixture({
      messages: [{ id: 'm2', classification: financeLabel(3400) }],
      partitions: trainPartitions(['m2']),
    });
    prisma.aiEmailClassification.createMany.mockRejectedValueOnce(
      new Error('chunk write failed'),
    );
    const service = new AiEmailReclassificationService(prisma as never);

    await expect(
      service.reclassifyAfterMessageVerification({
        userId: 'user-1',
        messageId: 'm2',
        correctedLabel: correctedFinanceLabel,
      }),
    ).rejects.toThrow('chunk write failed');
    expect(state.messages[0]).toMatchObject({
      processingStatus: 'REVIEW_REQUIRED',
      classificationStartedAt: null,
    });

    await expect(
      service.reclassifyAfterMessageVerification({
        userId: 'user-1',
        messageId: 'm2',
        correctedLabel: correctedFinanceLabel,
      }),
    ).resolves.toEqual({ requeued: 1 });
    expect(state.messages[0]).toMatchObject({ processingStatus: 'PROCESSED' });
  });

  it('marca FAILED el run del pase que falla y conserva el historial al reintentar', async () => {
    const { prisma, state } = makeFixture({
      messages: [{ id: 'm2', classification: financeLabel(3400) }],
      partitions: trainPartitions(['m2']),
    });
    prisma.aiEmailClassification.createMany.mockRejectedValueOnce(
      new Error('chunk write failed'),
    );
    const service = new AiEmailReclassificationService(prisma as never);

    await expect(
      service.reclassifyAfterMessageVerification({
        userId: 'user-1',
        messageId: 'm2',
        correctedLabel: correctedFinanceLabel,
      }),
    ).rejects.toThrow('chunk write failed');

    expect(state.runs).toHaveLength(1);
    expect(state.runs[0]).toMatchObject({
      status: 'FAILED',
      error: 'RECLASSIFICATION_FAILED',
      metrics: { requeued: 0, skipped: 0 },
    });
    expect(state.runs[0].completedAt).toBeInstanceOf(Date);

    await expect(
      service.reclassifyAfterMessageVerification({
        userId: 'user-1',
        messageId: 'm2',
        correctedLabel: correctedFinanceLabel,
      }),
    ).resolves.toEqual({ requeued: 1 });

    expect(state.runs).toHaveLength(2);
    expect(state.runs[0]).toMatchObject({ status: 'FAILED' });
    expect(state.runs[1]).toMatchObject({ status: 'COMPLETED' });
  });

  it('requeues the messages that used a reverted knowledge key', async () => {
    const { prisma, state } = makeFixture({
      messages: [{ id: 'm2' }, { id: 'm3' }, { id: 'm4' }],
      verifications: [
        { userId: 'user-1', targetType: 'EMAIL_MESSAGE', targetId: 'm3' },
      ],
      partitions: [
        ...trainPartitions(['m2', 'm3']),
        {
          userId: 'user-1',
          sourceType: 'EMAIL_MESSAGE',
          sourceId: 'm4',
          partition: 'HOLDOUT',
        },
      ],
      classifications: [
        {
          userId: 'user-1',
          messageId: 'm2',
          route: 'FINANCE',
          decisionPath: 'KNOWLEDGE',
          confidence: 0.98,
          knowledgeUsed: [
            {
              knowledgeType: 'EMAIL_DOMAIN',
              knowledgeKey: 'banco.com',
              scope: 'GLOBAL',
            },
          ],
        },
        {
          userId: 'user-1',
          messageId: 'm3',
          route: 'FINANCE',
          decisionPath: 'KNOWLEDGE',
          confidence: 0.98,
          knowledgeUsed: [
            {
              knowledgeType: 'EMAIL_DOMAIN',
              knowledgeKey: 'banco.com',
              scope: 'GLOBAL',
            },
          ],
        },
        {
          userId: 'user-1',
          messageId: 'm4',
          route: 'FINANCE',
          decisionPath: 'KNOWLEDGE',
          confidence: 0.98,
          knowledgeUsed: [
            {
              knowledgeType: 'EMAIL_DOMAIN',
              knowledgeKey: 'banco.com',
              scope: 'GLOBAL',
            },
          ],
        },
      ],
    });
    const service = new AiEmailReclassificationService(prisma as never);

    await expect(
      service.requeueAfterKnowledgeRevert({
        userId: 'user-1',
        knowledge: {
          knowledgeType: 'EMAIL_DOMAIN',
          knowledgeKey: 'banco.com',
        },
      }),
    ).resolves.toEqual({ requeued: 1 });

    const byId = new Map(
      state.messages.map((message) => [message.id, message]),
    );
    expect(byId.get('m2')).toMatchObject({ processingStatus: 'QUEUED' });
    expect(byId.get('m3')).toMatchObject({
      processingStatus: 'REVIEW_REQUIRED',
    });
    expect(byId.get('m4')).toMatchObject({
      processingStatus: 'REVIEW_REQUIRED',
    });
  });

  it('applies promoted global knowledge to the requester history', async () => {
    const { prisma, state } = makeFixture({
      messages: [
        { id: 'm2', classification: financeLabel(3400) },
        {
          id: 'm5',
          fromAddress: 'otro@otro.com',
          classification: financeLabel(10),
        },
      ],
      partitions: trainPartitions(['m2', 'm5']),
    });
    const service = new AiEmailReclassificationService(prisma as never);

    await expect(
      service.reclassifyAfterKnowledgePromotion({
        userId: 'user-1',
        knowledge: {
          knowledgeType: 'EMAIL_DOMAIN',
          knowledgeKey: 'banco.com',
          scope: 'GLOBAL',
          payload: {
            label: {
              relevance: true,
              semanticType: 'FIN_TRANSACTION',
              routes: ['FINANCE'],
              transaction: { kind: 'TRANSACTION' },
            },
          },
        },
      }),
    ).resolves.toEqual({ requeued: 1 });

    const byId = new Map(
      state.messages.map((message) => [message.id, message]),
    );
    expect(byId.get('m2')).toMatchObject({
      processingStatus: 'PROCESSED',
      classification: {
        relevance: true,
        semanticType: 'FIN_TRANSACTION',
        transaction: { amount: 3400, currency: 'DOP' },
      },
    });
    expect(byId.get('m5')).toMatchObject({
      processingStatus: 'REVIEW_REQUIRED',
      classification: financeLabel(10),
    });
    expect(
      state.classifications.find((row) => row.messageId === 'm2'),
    ).toMatchObject({
      knowledgeUsed: [
        {
          knowledgeType: 'EMAIL_DOMAIN',
          knowledgeKey: 'banco.com',
          scope: 'GLOBAL',
        },
      ],
    });
  });

  it('does not reclassify the sender of a HOLDOUT message', async () => {
    const { prisma, state } = makeFixture({
      messages: [{ id: 'h1' }, { id: 'h2', classification: financeLabel(10) }],
      partitions: [
        {
          userId: 'user-1',
          sourceType: 'EMAIL_MESSAGE',
          sourceId: 'h1',
          partition: 'HOLDOUT',
        },
        ...trainPartitions(['h2']),
      ],
    });
    const service = new AiEmailReclassificationService(prisma as never);

    await expect(
      service.reclassifyAfterMessageVerification({
        userId: 'user-1',
        messageId: 'h1',
        correctedLabel: correctedFinanceLabel,
      }),
    ).resolves.toEqual({ requeued: 0 });

    expect(state.messages.find(({ id }) => id === 'h2')).toMatchObject({
      processingStatus: 'REVIEW_REQUIRED',
      classification: financeLabel(10),
    });
  });

  it('restores the previous status when the verified label is incomplete', async () => {
    const { prisma, state } = makeFixture({
      messages: [{ id: 'm2', classification: null }],
      partitions: trainPartitions(['m2']),
    });
    const service = new AiEmailReclassificationService(prisma as never);

    await expect(
      service.reclassifyAfterMessageVerification({
        userId: 'user-1',
        messageId: 'm2',
        correctedLabel: { relevance: true },
      }),
    ).resolves.toEqual({ requeued: 0 });

    expect(state.messages[0]).toMatchObject({
      processingStatus: 'REVIEW_REQUIRED',
      classificationStartedAt: null,
    });
    expect(state.signals).toHaveLength(0);
  });

  it('does not persist after another claim takes the message over', async () => {
    const { prisma, state } = makeFixture({
      messages: [
        { id: 'm1' },
        { id: 'm2', classification: financeLabel(3400) },
      ],
      verifications: [
        { userId: 'user-1', targetType: 'EMAIL_MESSAGE', targetId: 'm1' },
      ],
      partitions: trainPartitions(['m1', 'm2']),
    });
    const takeoverClaim = new Date(Date.UTC(2026, 10, 1, 2));
    const foreignClassification: StoredClassification = {
      userId: 'user-1',
      messageId: 'm2',
      route: 'NONE',
      decisionPath: 'MODEL',
      confidence: 0.31,
      knowledgeUsed: [],
    };
    const updateMessage =
      prisma.aiEmailMessage.updateMany.getMockImplementation();
    if (!updateMessage) {
      throw new Error('message update mock is missing');
    }
    prisma.aiEmailMessage.updateMany.mockImplementationOnce((command) => {
      const takenOver = state.messages.find(({ id }) => id === 'm2');
      if (!takenOver) {
        throw new Error('fixture message m2 is missing');
      }
      Object.assign(takenOver, {
        processingStatus: 'PROCESSED',
        classificationStartedAt: takeoverClaim,
      });
      state.classifications = [foreignClassification];
      return updateMessage(command);
    });
    const service = new AiEmailReclassificationService(prisma as never);

    await service.reclassifyAfterMessageVerification({
      userId: 'user-1',
      messageId: 'm1',
      correctedLabel: correctedFinanceLabel,
    });

    expect(state.classifications).toEqual([foreignClassification]);
    expect(state.messages.find(({ id }) => id === 'm2')).toMatchObject({
      processingStatus: 'PROCESSED',
      classificationStartedAt: takeoverClaim,
    });
    expect(state.signals).toHaveLength(0);
  });
});
