import { BadRequestException, NotFoundException } from '@nestjs/common';
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

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    userId: 'user-1',
    dryRun: true,
    status: 'QUEUED',
    selectionMode: 'IDS',
    messageIds: ['message-1'],
    sender: null,
    dateFrom: null,
    dateTo: null,
    total: 1,
    processed: 0,
    result: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date('2026-11-19T10:00:00.000Z'),
    ...overrides,
  };
}

function makeJobsMock() {
  return {
    create: jest.fn().mockResolvedValue(jobRow()),
    findForUser: jest.fn().mockResolvedValue(jobRow()),
    claim: jest.fn().mockResolvedValue(jobRow({ status: 'RUNNING' })),
    updateProgress: jest.fn().mockResolvedValue(undefined),
    complete: jest.fn().mockResolvedValue(undefined),
    fail: jest.fn().mockResolvedValue(undefined),
  };
}

function setup({
  messages = [message('message-1')],
  classification = classified,
  previewResult = appliedPreview,
  consumeResult = {
    outcome: 'APPLIED',
    domainReferences: [{ type: 'FinTransaction', id: 'transaction-1' }],
  },
  queue,
  jobs = makeJobsMock(),
}: {
  messages?: Array<ReturnType<typeof message>>;
  classification?: Record<string, unknown>;
  previewResult?: Record<string, unknown>;
  consumeResult?: Record<string, unknown>;
  queue?: { add: jest.Mock };
  jobs?: ReturnType<typeof makeJobsMock>;
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
    prisma,
    jobs as never,
    classificationService as never,
    consumers as never,
    signals as never,
    queue as never,
  );
  return {
    service,
    prisma,
    jobs,
    findMany,
    classificationService,
    financeConsumer,
    consumers,
    signals,
  };
}

describe('EmailSampleImportService', () => {
  it('allows up to fifty ids in dry run', async () => {
    const messages = Array.from({ length: 50 }, (_, index) =>
      message(`message-${index + 1}`),
    );
    const { service } = setup({ messages });
    const messageIds = messages.map((item) => item.id);

    const manifest = await service.run({
      userId: 'user-1',
      dryRun: true,
      selection: { messageIds },
    });

    expect(manifest.selection.cap).toBe(50);
    expect(manifest.items).toHaveLength(50);
  });

  it('rejects more than fifty ids', async () => {
    const { service, classificationService } = setup();
    const messageIds = Array.from({ length: 51 }, (_, index) => `m-${index}`);
    await expect(
      service.run({
        userId: 'user-1',
        dryRun: true,
        selection: { messageIds },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(classificationService.previewClassification).not.toHaveBeenCalled();
  });

  it('keeps the real import capped at twenty', async () => {
    const { service, classificationService } = setup();
    const messageIds = Array.from({ length: 21 }, (_, index) => `m-${index}`);
    await expect(
      service.run({
        userId: 'user-1',
        dryRun: false,
        selection: { messageIds },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(classificationService.reclassifyMessageNow).not.toHaveBeenCalled();
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

  it('selects by sender and window with a cap of fifty in dry run', async () => {
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
        take: 50,
      }),
    );
  });

  it('caps the real sender window at twenty', async () => {
    const { service, findMany } = setup();

    await service.run({
      userId: 'user-1',
      dryRun: false,
      selection: {
        sender: 'bhd.com.do',
        dateFrom: new Date('2026-10-26T00:00:00.000Z'),
        dateTo: new Date('2026-11-02T23:59:59.999Z'),
      },
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20 }),
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
      provider: 'test-provider',
      model: 'test-model',
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

  it('returns null provider and model when the preview used no inference model', async () => {
    const { service } = setup({
      classification: {
        ...classified,
        method: 'KNOWLEDGE',
        provider: null,
        model: null,
      },
    });

    const manifest = await service.run({
      userId: 'user-1',
      dryRun: true,
      selection: { messageIds: ['message-1'] },
    });

    expect(manifest.items[0]).toMatchObject({
      provider: null,
      model: null,
    });
  });

  it('marks a provider failure apart from a non-transaction', async () => {
    const { service } = setup({
      classification: {
        kind: 'unavailable',
        reason: 'INFERENCE_PROVIDER_FAILURE',
      },
    });

    const manifest = await service.run({
      userId: 'user-1',
      dryRun: true,
      selection: { messageIds: ['message-1'] },
    });

    expect(manifest.items[0]).toMatchObject({
      classification: null,
      classificationUnavailableReason: 'INFERENCE_PROVIDER_FAILURE',
      signal: { published: false, reason: 'CLASSIFICATION_UNAVAILABLE' },
      prediction: null,
    });
  });

  it('keeps a non-transaction separate from a provider failure', async () => {
    const { service } = setup({
      classification: {
        kind: 'classified',
        classification: {
          relevance: true,
          semanticType: 'FIN_STATEMENT_NOTICE',
          routes: ['FINANCE'],
          confidence: 0.99,
        },
        method: 'DETERMINISTIC',
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

    expect(manifest.items[0]).toMatchObject({
      signal: { published: false, reason: 'NO_TRANSACTION_CANDIDATE' },
      prediction: null,
    });
  });

  it('preserves every Finance review reason in the dry run prediction', async () => {
    const { service, financeConsumer } = setup({
      previewResult: {
        outcome: 'REVIEW_REQUIRED',
        reason: 'NO_LEDGER_TARGET',
        reviewReasons: ['NO_LEDGER_TARGET', 'TRANSACTION_DATE_SUGGESTED'],
      },
    });

    const manifest = await service.run({
      userId: 'user-1',
      dryRun: true,
      selection: { messageIds: ['message-1'] },
    });

    expect(manifest.items[0].prediction).toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'NO_LEDGER_TARGET',
      reviewReasons: ['NO_LEDGER_TARGET', 'TRANSACTION_DATE_SUGGESTED'],
    });
    expect(financeConsumer.consume).not.toHaveBeenCalled();
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

  it('returns the job reference before any message is processed', async () => {
    const queue = { add: jest.fn().mockResolvedValue({}) };
    const { service, jobs, classificationService } = setup({ queue });

    const view = await service.start({
      userId: 'user-1',
      dryRun: true,
      selection: { messageIds: ['message-1'] },
    });

    expect(jobs.create).toHaveBeenCalledWith({
      userId: 'user-1',
      dryRun: true,
      selectionMode: 'IDS',
      messageIds: ['message-1'],
      sender: null,
      dateFrom: null,
      dateTo: null,
    });
    expect(queue.add).toHaveBeenCalledWith(
      'run-sample-import',
      { userId: 'user-1', sampleImportId: 'job-1' },
      expect.objectContaining({ jobId: 'job-1' }),
    );
    expect(view).toMatchObject({
      id: 'job-1',
      status: 'QUEUED',
      dryRun: true,
      progress: { processed: 0, total: 1 },
      result: null,
    });
    expect(classificationService.previewClassification).not.toHaveBeenCalled();
  });

  it('keeps the sender window in the job', async () => {
    const queue = { add: jest.fn().mockResolvedValue({}) };
    const { service, jobs } = setup({ queue });
    const dateFrom = new Date('2026-10-26T00:00:00.000Z');
    const dateTo = new Date('2026-11-02T23:59:59.999Z');

    await service.start({
      userId: 'user-1',
      dryRun: false,
      selection: { sender: 'bhd.com.do', dateFrom, dateTo },
    });

    expect(jobs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        selectionMode: 'SENDER_WINDOW',
        messageIds: ['message-1'],
        sender: 'bhd.com.do',
        dateFrom,
        dateTo,
      }),
    );
  });

  it('rejects an invalid selection before creating the job', async () => {
    const queue = { add: jest.fn().mockResolvedValue({}) };
    const { service, jobs } = setup({ queue });

    await expect(
      service.start({
        userId: 'user-1',
        dryRun: true,
        selection: { messageIds: [] },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(jobs.create).not.toHaveBeenCalled();
  });

  it('runs the claimed job, reports progress and stores the manifest', async () => {
    const messages = [message('message-1'), message('message-2')];
    const jobs = makeJobsMock();
    jobs.claim.mockResolvedValueOnce(
      jobRow({
        status: 'RUNNING',
        messageIds: ['message-1', 'message-2'],
        total: 2,
      }),
    );
    const { service } = setup({ messages, jobs });

    await service.process('job-1');

    expect(jobs.updateProgress).toHaveBeenNthCalledWith(1, 'job-1', 1);
    expect(jobs.updateProgress).toHaveBeenNthCalledWith(2, 'job-1', 2);
    expect(jobs.complete).toHaveBeenCalledTimes(1);
    const completed = jobs.complete.mock.calls[0] as [
      string,
      {
        dryRun: boolean;
        selection: { mode: string; requested: number };
        items: unknown[];
      },
    ];
    expect(completed[0]).toBe('job-1');
    expect(completed[1]).toMatchObject({
      dryRun: true,
      selection: { mode: 'IDS', requested: 2 },
    });
    expect(completed[1].items).toHaveLength(2);
    expect(jobs.fail).not.toHaveBeenCalled();
  });

  it('does not run a job that is already running or finished', async () => {
    const jobs = makeJobsMock();
    jobs.claim.mockResolvedValueOnce(null);
    const { service, classificationService } = setup({ jobs });

    await service.process('job-1');

    expect(classificationService.previewClassification).not.toHaveBeenCalled();
    expect(jobs.complete).not.toHaveBeenCalled();
  });

  it('marks a failed run with a code that carries no message content', async () => {
    const { service, jobs, classificationService } = setup();
    classificationService.previewClassification.mockRejectedValueOnce(
      new Error('proveedor: asunto del correo'),
    );

    await service.process('job-1');

    expect(jobs.fail).toHaveBeenCalledWith('job-1', 'SAMPLE_IMPORT_FAILED');
    expect(jobs.complete).not.toHaveBeenCalled();
  });

  it('returns the terminal manifest of a finished job', async () => {
    const jobs = makeJobsMock();
    jobs.findForUser.mockResolvedValueOnce(
      jobRow({
        status: 'COMPLETED',
        processed: 1,
        result: {
          dryRun: true,
          selection: { mode: 'IDS', requested: 1, included: 1, cap: 50 },
          summary: { included: 1, notFound: 0 },
          items: [],
        },
        startedAt: new Date('2026-11-19T10:00:01.000Z'),
        finishedAt: new Date('2026-11-19T10:01:00.000Z'),
      }),
    );
    const { service } = setup({ jobs });

    const view = await service.getForUser('user-1', 'job-1');

    expect(view).toMatchObject({
      status: 'COMPLETED',
      progress: { processed: 1, total: 1 },
      startedAt: '2026-11-19T10:00:01.000Z',
      finishedAt: '2026-11-19T10:01:00.000Z',
    });
    expect(view.result).toMatchObject({ dryRun: true });
  });

  it('hides the job of another owner', async () => {
    const jobs = makeJobsMock();
    jobs.findForUser.mockResolvedValueOnce(null);
    const { service } = setup({ jobs });

    await expect(service.getForUser('user-2', 'job-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(jobs.findForUser).toHaveBeenCalledWith('user-2', 'job-1');
  });
});
