import { BadRequestException } from '@nestjs/common';
import { EmailSampleImportService } from './email-sample-import.service';

const financeLabel = {
  relevance: true,
  semanticType: 'FIN_TRANSACTION',
  routes: ['FINANCE'],
  transaction: {
    kind: 'TRANSACTION',
    amount: 125.5,
    currency: 'DOP',
    transactionDate: '2026-11-01T00:00:00.000Z',
    direction: 'DEBIT',
    merchant: 'Farmacia',
    bankReference: 'BHD-1',
    last4: '4821',
    movementClass: 'PURCHASE',
    bankStatusNormalized: 'APPROVED',
  },
  confidence: 0.93,
};

function message(id: string) {
  return {
    id,
    receivedAt: new Date('2026-11-02T12:00:00.000Z'),
    fromAddress: 'notificaciones@bhd.com.do',
    fromDomain: 'bhd.com.do',
    subject: 'Consumo',
  };
}

const classified = {
  kind: 'classified' as const,
  classification: financeLabel,
  method: 'MODEL' as const,
  provider: 'test-provider',
  model: 'test-model',
  auditSample: false,
  knowledgeUsed: [],
};

const appliedPreview = {
  outcome: 'APPLIED' as const,
  movement: {
    accountId: 'account-1',
    cardId: null,
    amount: 125.5,
    currency: 'DOP',
    type: 'DEBIT',
    status: 'CONFIRMED',
    transactionDate: '2026-11-01T00:00:00.000Z',
    description: 'Farmacia',
    categoryId: null,
    legRole: null,
    externalReference: 'BHD-1',
    importReference: 'email-message-1',
  },
};

function setup({
  messages = [message('message-1')],
  classification = classified,
  previewResult = appliedPreview,
  consumeResult = {
    outcome: 'APPLIED',
    domainReferences: [{ type: 'FinTransaction', id: 'transaction-1' }],
  },
}: {
  messages?: Array<ReturnType<typeof message>>;
  classification?: Record<string, unknown>;
  previewResult?: Record<string, unknown>;
  consumeResult?: Record<string, unknown>;
} = {}) {
  const findMany = jest.fn((args: Record<string, unknown>) => {
    const where = args.where as { id?: { in?: readonly string[] } } | undefined;
    const requested = where?.id?.in;
    if (!requested) {
      return messages;
    }
    return messages.filter((row) => requested.includes(row.id));
  });
  const prisma = {
    aiEmailMessage: {
      findMany,
      findFirst: jest.fn().mockResolvedValue(messages[0] ?? null),
    },
  };
  const classificationService = {
    previewClassification: jest.fn().mockResolvedValue(classification),
    reclassifyMessageNow: jest.fn().mockResolvedValue(classification),
  };
  const financeConsumer = {
    domain: 'FINANCE',
    preview: jest.fn().mockResolvedValue(previewResult),
    consume: jest.fn().mockResolvedValue(consumeResult),
  };
  const consumers = { get: jest.fn().mockReturnValue(financeConsumer) };
  const signals = {
    recordConsumerOutcome: jest.fn().mockResolvedValue(undefined),
  };
  const service = new EmailSampleImportService(
    prisma as never,
    classificationService as never,
    consumers as never,
    signals as never,
  );
  return {
    service,
    prisma,
    findMany,
    classificationService,
    financeConsumer,
    consumers,
    signals,
  };
}

describe('EmailSampleImportService', () => {
  it('rejects more than twenty ids', async () => {
    const { service, classificationService } = setup();
    const messageIds = Array.from({ length: 21 }, (_, index) => `m-${index}`);
    await expect(
      service.run({
        userId: 'user-1',
        dryRun: true,
        selection: { messageIds },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(classificationService.previewClassification).not.toHaveBeenCalled();
  });

  it('rejects an empty id list', async () => {
    const { service } = setup();
    await expect(
      service.run({
        userId: 'user-1',
        dryRun: true,
        selection: { messageIds: [] },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a selection that mixes ids with a sender window', async () => {
    const { service } = setup();
    await expect(
      service.run({
        userId: 'user-1',
        dryRun: true,
        selection: {
          messageIds: ['message-1'],
          sender: 'bhd.com.do',
          dateFrom: new Date('2026-10-26T00:00:00.000Z'),
          dateTo: new Date('2026-11-02T23:59:59.999Z'),
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a sender window without dates', async () => {
    const { service } = setup();
    await expect(
      service.run({
        userId: 'user-1',
        dryRun: true,
        selection: { sender: 'bhd.com.do' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('selects by sender and window with a cap of twenty', async () => {
    const { service, findMany } = setup();

    await service.run({
      userId: 'user-1',
      dryRun: true,
      selection: {
        sender: 'bhd.com.do',
        dateFrom: new Date('2026-10-26T00:00:00.000Z'),
        dateTo: new Date('2026-11-02T23:59:59.999Z'),
      },
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-1',
          receivedAt: {
            gte: new Date('2026-10-26T00:00:00.000Z'),
            lte: new Date('2026-11-02T23:59:59.999Z'),
          },
          OR: [
            { fromDomain: { equals: 'bhd.com.do', mode: 'insensitive' } },
            { fromAddress: { equals: 'bhd.com.do', mode: 'insensitive' } },
          ],
        },
        take: 20,
      }),
    );
  });

  it('builds the manifest without writing anything in dry run', async () => {
    const { service, classificationService, financeConsumer, signals } =
      setup();

    const manifest = await service.run({
      userId: 'user-1',
      dryRun: true,
      selection: { messageIds: ['message-1'] },
    });

    expect(manifest.dryRun).toBe(true);
    expect(manifest.summary).toMatchObject({
      included: 1,
      wouldPublishSignal: 1,
      wouldCreateMovement: 1,
      reviewRequired: 0,
    });
    expect(manifest.items[0]).toMatchObject({
      messageId: 'message-1',
      status: 'INCLUDED',
      fromAddress: 'notificaciones@bhd.com.do',
      receivedAt: '2026-11-02T12:00:00.000Z',
      classification: {
        semanticType: 'FIN_TRANSACTION',
        confidence: 0.93,
        movementClass: 'PURCHASE',
        amount: 125.5,
        currency: 'DOP',
      },
      hints: {
        bankReference: 'BHD-1',
        merchant: 'Farmacia',
        last4: '4821',
      },
      signal: { published: true },
      prediction: {
        outcome: 'APPLIED',
        movement: expect.objectContaining({ amount: 125.5 }),
      },
    });
    expect(classificationService.previewClassification).toHaveBeenCalledWith({
      userId: 'user-1',
      messageId: 'message-1',
    });
    expect(classificationService.reclassifyMessageNow).not.toHaveBeenCalled();
    expect(financeConsumer.consume).not.toHaveBeenCalled();
    expect(signals.recordConsumerOutcome).not.toHaveBeenCalled();
    expect(manifest.items[0].execution).toBeUndefined();
  });

  it('includes both card payment targets in the dry run prediction', async () => {
    const { service } = setup({
      previewResult: {
        outcome: 'APPLIED',
        cardPayment: {
          sourceAccountId: 'account-1',
          cardId: 'card-1',
          amount: 125.5,
          currency: 'DOP',
          status: 'CONFIRMED',
          transactionDate: '2026-11-01T00:00:00.000Z',
          description: 'Pago de tarjeta',
          externalReference: 'BHD-1',
          importReference: 'email-message-1',
        },
      },
    });

    const manifest = await service.run({
      userId: 'user-1',
      dryRun: true,
      selection: { messageIds: ['message-1'] },
    });

    expect(manifest.items[0].prediction).toMatchObject({
      outcome: 'APPLIED',
      cardPayment: {
        sourceAccountId: 'account-1',
        cardId: 'card-1',
        amount: 125.5,
      },
    });
  });

  it('marks a classification that would not publish a signal', async () => {
    const { service, financeConsumer } = setup({
      classification: {
        kind: 'classified',
        classification: {
          relevance: true,
          semanticType: 'FIN_ACCOUNT_NOTICE',
          routes: ['FINANCE'],
          confidence: 0.8,
        },
        method: 'MODEL',
        provider: null,
        model: null,
        auditSample: false,
        knowledgeUsed: [],
      },
    });

    const manifest = await service.run({
      userId: 'user-1',
      dryRun: true,
      selection: { messageIds: ['message-1'] },
    });

    expect(manifest.items[0].signal).toEqual({
      published: false,
      reason: 'NO_TRANSACTION_CANDIDATE',
    });
    expect(manifest.summary.wouldPublishSignal).toBe(0);
    expect(financeConsumer.preview).not.toHaveBeenCalled();
  });

  it('keeps a missing message as a manifest row', async () => {
    const { service, classificationService } = setup({
      messages: [message('message-1')],
    });

    const manifest = await service.run({
      userId: 'user-1',
      dryRun: true,
      selection: { messageIds: ['message-9'] },
    });

    expect(manifest.items[0]).toMatchObject({
      messageId: 'message-9',
      status: 'NOT_FOUND',
    });
    expect(manifest.summary).toMatchObject({ included: 0, notFound: 1 });
    expect(classificationService.previewClassification).not.toHaveBeenCalled();
  });

  it('reports a message whose classification is unavailable', async () => {
    const { service } = setup({
      classification: {
        kind: 'unavailable',
        reason: 'MODEL_BUDGET_EXHAUSTED',
      },
    });

    const manifest = await service.run({
      userId: 'user-1',
      dryRun: true,
      selection: { messageIds: ['message-1'] },
    });

    expect(manifest.items[0]).toMatchObject({
      status: 'INCLUDED',
      classificationUnavailableReason: 'MODEL_BUDGET_EXHAUSTED',
      signal: { published: false, reason: 'CLASSIFICATION_UNAVAILABLE' },
    });
  });

  it('executes only the requested ids and records each outcome', async () => {
    const {
      service,
      classificationService,
      financeConsumer,
      signals,
      findMany,
    } = setup();

    const manifest = await service.run({
      userId: 'user-1',
      dryRun: false,
      selection: { messageIds: ['message-1'] },
    });

    expect(manifest.dryRun).toBe(false);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', id: { in: ['message-1'] } },
      }),
    );
    expect(classificationService.reclassifyMessageNow).toHaveBeenCalledTimes(1);
    expect(financeConsumer.consume).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        signalId: 'email-message-1',
        sourceId: 'message-1',
        signalType: 'FINANCE.TRANSACTION_DETECTED',
      }),
    );
    expect(financeConsumer.preview).not.toHaveBeenCalled();
    expect(signals.recordConsumerOutcome).toHaveBeenCalledWith(
      'user-1',
      'email-message-1',
      expect.objectContaining({ outcome: 'APPLIED' }),
    );
    expect(manifest.items[0].execution).toMatchObject({
      outcome: 'APPLIED',
      transactionId: 'transaction-1',
    });
  });

  it('reports a replay as already applied without extra rows', async () => {
    const { service, financeConsumer, signals } = setup({
      consumeResult: {
        outcome: 'ALREADY_APPLIED',
        domainReferences: [{ type: 'FinTransaction', id: 'transaction-1' }],
      },
    });

    const manifest = await service.run({
      userId: 'user-1',
      dryRun: false,
      selection: { messageIds: ['message-1'] },
    });

    expect(manifest.items[0].execution).toMatchObject({
      outcome: 'ALREADY_APPLIED',
      transactionId: 'transaction-1',
    });
    expect(financeConsumer.consume).toHaveBeenCalledTimes(1);
    expect(signals.recordConsumerOutcome).toHaveBeenCalledTimes(1);
  });

  it('never widens the selection by sender or template', async () => {
    const { service, findMany, classificationService } = setup();

    await service.run({
      userId: 'user-1',
      dryRun: false,
      selection: { messageIds: ['message-1'] },
    });

    expect(findMany).toHaveBeenCalledTimes(1);
    const where = (
      findMany.mock.calls[0][0] as { where: Record<string, unknown> }
    ).where;
    expect(where).not.toHaveProperty('fromAddress');
    expect(where).not.toHaveProperty('fromDomain');
    expect(where).not.toHaveProperty('templateFingerprint');
    expect(classificationService.reclassifyMessageNow).toHaveBeenCalledTimes(1);
  });
});
