import type { ConfigService } from '@nestjs/config';
import { AppEvents } from '@personal-os/core';
import type { DomainEventPublisherPort } from '../../events/application/ports/domain-event-publisher.port';
import type { FinanceOutboxDispatcher } from '../../events/infrastructure/finance-outbox.dispatcher';
import type { EmailSourceRepository } from '../infrastructure/email-source.repository';
import { IngestionService } from './ingestion.service';

describe('IngestionService.completeEmailSyncSuccessWithEvent', () => {
  it('enqueues finance.email_sync.completed via same-TX outbox helper', async () => {
    const completeEmailSyncSuccessWithOutbox = jest
      .fn()
      .mockResolvedValue(undefined);
    const repo = {
      completeEmailSyncSuccessWithOutbox,
    } as unknown as EmailSourceRepository;

    const processBatch = jest.fn();
    const outboxDispatcher = {
      processBatch,
    } as unknown as FinanceOutboxDispatcher;

    const config = {
      get: jest.fn(),
    } as unknown as ConfigService;

    const events = {
      enqueue: jest.fn(),
    } as unknown as DomainEventPublisherPort;

    const service = new IngestionService(
      repo,
      config as never,
      events,
      outboxDispatcher,
      { assertFinanceEmailSyncEnabled: jest.fn() } as never,
      { assertInstitutionOwned: jest.fn() } as never,
      { execute: jest.fn() } as never,
      { findLatestCategoryIdByMerchant: jest.fn() } as never,
      undefined,
    );

    await service.completeEmailSyncSuccessWithEvent({
      logId: 'log-1',
      userId: 'user-1',
      sourceId: 'src-1',
      emailsScanned: 2,
      transactionsNew: 1,
      transactionIds: ['tx-1'],
      countsByStatus: { PENDING: 1 },
    });

    expect(completeEmailSyncSuccessWithOutbox).toHaveBeenCalledWith(
      'log-1',
      {
        status: 'SUCCESS',
        emailsScanned: 2,
        transactionsNew: 1,
      },
      expect.objectContaining({
        eventName: AppEvents.FINANCE_EMAIL_SYNC_COMPLETED,
        aggregateType: 'FinEmailSource',
        aggregateId: 'src-1',
        userId: 'user-1',
        payload: expect.objectContaining({
          sourceId: 'src-1',
          emailsScanned: 2,
          transactionsNew: 1,
          transactionIds: ['tx-1'],
          countsByStatus: { PENDING: 1 },
          version: 1,
        }),
      }),
    );
    expect(processBatch).toHaveBeenCalled();
  });
});

describe('IngestionService.completeEmailSyncFailureWithEvent', () => {
  it('enqueues finance.email_sync.failed via same-TX outbox helper', async () => {
    const completeEmailSyncFailureWithOutbox = jest
      .fn()
      .mockResolvedValue(undefined);
    const repo = {
      completeEmailSyncFailureWithOutbox,
    } as unknown as EmailSourceRepository;

    const processBatch = jest.fn();
    const outboxDispatcher = {
      processBatch,
    } as unknown as FinanceOutboxDispatcher;

    const config = {
      get: jest.fn(),
    } as unknown as ConfigService;

    const events = {
      enqueue: jest.fn(),
    } as unknown as DomainEventPublisherPort;

    const service = new IngestionService(
      repo,
      config,
      events,
      outboxDispatcher,
      { assertFinanceEmailSyncEnabled: jest.fn() } as never,
      { assertInstitutionOwned: jest.fn() } as never,
      { execute: jest.fn() } as never,
      { findLatestCategoryIdByMerchant: jest.fn() } as never,
      undefined,
    );

    await service.completeEmailSyncFailureWithEvent({
      logId: 'log-1',
      userId: 'user-1',
      sourceId: 'src-1',
      emailsScanned: 2,
      transactionsNew: 0,
      error: 'gmail 500',
    });

    expect(completeEmailSyncFailureWithOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'log-1',
        emailsScanned: 2,
        transactionsNew: 0,
        error: 'gmail 500',
        outbox: expect.objectContaining({
          eventName: AppEvents.FINANCE_EMAIL_SYNC_FAILED,
          aggregateType: 'FinEmailSource',
          aggregateId: 'src-1',
          userId: 'user-1',
          payload: expect.objectContaining({
            sourceId: 'src-1',
            error: 'gmail 500',
            version: 1,
          }),
        }),
      }),
    );
    expect(processBatch).toHaveBeenCalled();
  });
});

describe('IngestionService pending assignment', () => {
  const listPendingAssignmentMessagesPage = jest.fn();
  const listRecentEmailMessagesPage = jest.fn();
  const findEmailMessageById = jest.fn();
  const listCategories = jest.fn();
  const listInstitutionDestinations = jest.fn();
  const upsertEmailMessage = jest.fn();
  const repo = {
    listPendingAssignmentMessagesPage,
    listRecentEmailMessagesPage,
    findEmailMessageById,
    listCategories,
    listInstitutionDestinations,
    upsertEmailMessage,
  } as unknown as EmailSourceRepository;

  const users = {
    assertFinanceEmailSyncEnabled: jest.fn().mockResolvedValue(undefined),
  };
  const ownership = {
    assertAccountOwned: jest.fn().mockResolvedValue({
      id: 'acc-1',
      institutionId: 'inst-1',
      isActive: true,
    }),
    assertCardOwned: jest.fn(),
  };
  const importEmail = { execute: jest.fn() };
  const ledger = {
    findLatestCategoryIdByMerchant: jest.fn().mockResolvedValue(null),
  };

  const service = new IngestionService(
    repo,
    { get: jest.fn() } as never,
    { enqueue: jest.fn() },
    { processBatch: jest.fn() } as never,
    users as never,
    ownership as never,
    importEmail as never,
    ledger as never,
    undefined,
  );

  const pendingMessage = {
    id: 'em-1',
    sourceId: 'src-1',
    gmailMessageId: 'msg-1',
    outcome: 'PENDING_ASSIGNMENT' as const,
    instrumentHint: 'ACCOUNT',
    lastFourHint: '1234',
    accountNumberHint: '5678',
    extractedPayload: {
      amount: 12.5,
      currency: 'DOP',
      type: 'DEBIT' as const,
      transactionDate: '2026-08-01',
      description: 'Coffee',
      merchant: 'Cafe',
      bankStatusNormalized: 'APPROVED' as const,
      statusConfidence: 0.9,
    },
    provider: 'groq',
    model: 'test',
    reason: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    source: {
      institutionId: 'inst-1',
      connection: { emailAddress: 'user@gmail.com' },
      institution: { name: 'Bank' },
    },
    transaction: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    users.assertFinanceEmailSyncEnabled.mockResolvedValue(undefined);
    listCategories.mockResolvedValue([]);
    upsertEmailMessage.mockResolvedValue({ id: 'em-1' });
    importEmail.execute.mockResolvedValue({ id: 'tx-1' });
  });

  it('lists pending messages without tokens', async () => {
    listPendingAssignmentMessagesPage.mockResolvedValue([pendingMessage]);

    await expect(
      service.listPendingAssignment('user-1', { limit: 20 }),
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          id: 'em-1',
          institutionId: 'inst-1',
          lastFourHint: '1234',
        }),
      ],
      hasMore: false,
      nextCursor: null,
    });
  });

  it('lists recent extract outcomes including imported mail', async () => {
    listRecentEmailMessagesPage.mockResolvedValue([
      { ...pendingMessage, outcome: 'IMPORTED' },
    ]);

    await expect(
      service.listRecentMessages('user-1', { limit: 20 }),
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          id: 'em-1',
          outcome: 'IMPORTED',
          institutionName: 'Bank',
        }),
      ],
      hasMore: false,
      nextCursor: null,
    });
  });

  it('returns the existing transaction when assignment is retried after import', async () => {
    findEmailMessageById.mockResolvedValue({
      ...pendingMessage,
      outcome: 'IMPORTED',
      transaction: { id: 'tx-1' },
    });

    await expect(
      service.assignPendingMessage('user-1', 'em-1', { accountId: 'acc-1' }),
    ).resolves.toEqual({ assigned: true, transactionId: 'tx-1' });
    expect(importEmail.execute).not.toHaveBeenCalled();
  });

  it('imports a pending message onto the chosen account', async () => {
    findEmailMessageById.mockResolvedValue(pendingMessage);

    await expect(
      service.assignPendingMessage('user-1', 'em-1', { accountId: 'acc-1' }),
    ).resolves.toEqual({ assigned: true, transactionId: 'tx-1' });
    expect(importEmail.execute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        accountId: 'acc-1',
        emailMessageId: 'em-1',
      }),
    );
  });

  it('retries automatic routing and stays pending when still ambiguous', async () => {
    findEmailMessageById.mockResolvedValue({
      ...pendingMessage,
      accountNumberHint: null,
      lastFourHint: null,
    });
    listInstitutionDestinations.mockResolvedValue([
      [
        { id: 'acc-1', accountNumber: '11111111' },
        { id: 'acc-2', accountNumber: '22222222' },
      ],
      [],
    ]);

    await expect(
      service.retryPendingMessage('user-1', 'em-1'),
    ).resolves.toMatchObject({ id: 'em-1', institutionId: 'inst-1' });
    expect(importEmail.execute).not.toHaveBeenCalled();
  });

  it('retries pending assignment using the stored account number hint', async () => {
    findEmailMessageById.mockResolvedValue(pendingMessage);
    listInstitutionDestinations.mockResolvedValue([
      [
        { id: 'acc-1', accountNumber: '001122335678' },
        { id: 'acc-2', accountNumber: '998877440000' },
      ],
      [],
    ]);

    await expect(
      service.retryPendingMessage('user-1', 'em-1'),
    ).resolves.toEqual({ assigned: true, transactionId: 'tx-1' });
    expect(importEmail.execute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ accountId: 'acc-1', emailMessageId: 'em-1' }),
    );
  });
});

describe('IngestionService mailbox linking', () => {
  const findConnectionByUserEmail = jest.fn();
  const findSourceByUserAndInstitution = jest.fn();
  const createEmailSource = jest.fn();
  const updateEmailSource = jest.fn();
  const listMailboxes = jest.fn();
  const deactivateMailbox = jest.fn();
  const repo = {
    findConnectionByUserEmail,
    findSourceByUserAndInstitution,
    createEmailSource,
    updateEmailSource,
    listMailboxes,
    deactivateMailbox,
  } as unknown as EmailSourceRepository;

  const users = {
    assertFinanceEmailSyncEnabled: jest.fn().mockResolvedValue(undefined),
    isFinanceEmailSyncAutomatic: jest.fn().mockResolvedValue(false),
  };
  const ownership = {
    assertInstitutionOwned: jest.fn().mockResolvedValue(undefined),
    assertInstitutionAcceptsBankProducts: jest
      .fn()
      .mockResolvedValue(undefined),
  };

  const service = new IngestionService(
    repo,
    { get: jest.fn() } as never,
    { enqueue: jest.fn() },
    { processBatch: jest.fn() } as never,
    users as never,
    ownership as never,
    { execute: jest.fn() } as never,
    { findLatestCategoryIdByMerchant: jest.fn() } as never,
    undefined,
  );

  const mappedSource = {
    id: 'src-1',
    connectionId: 'conn-1',
    institutionId: 'inst-1',
    institution: { name: 'BHD' },
    bankSenderEmails: ['alertas@bhd.com.do'],
    bankDomain: 'bhd.com.do',
    label: null,
    isActive: true,
    lastSyncedAt: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    logs: [],
    connection: {
      emailAddress: 'me@gmail.com',
      provider: 'gmail',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    users.assertFinanceEmailSyncEnabled.mockResolvedValue(undefined);
    users.isFinanceEmailSyncAutomatic.mockResolvedValue(false);
    ownership.assertInstitutionOwned.mockResolvedValue(undefined);
  });

  it('refuses to create a source without an authorized mailbox', async () => {
    findConnectionByUserEmail.mockResolvedValue(null);
    await expect(
      service.createEmailSource('user-1', {
        emailAddress: 'me@gmail.com',
        bankSenderEmail: 'alertas@bhd.com.do',
        institutionId: 'inst-1',
      }),
    ).rejects.toThrow('Conecta Gmail antes de vincular un banco');
  });

  it('refuses to create a source when the mailbox has no refresh token', async () => {
    findConnectionByUserEmail.mockResolvedValue({
      id: 'conn-1',
      refreshToken: null,
    });
    await expect(
      service.createEmailSource('user-1', {
        emailAddress: 'me@gmail.com',
        bankSenderEmail: 'alertas@bhd.com.do',
        institutionId: 'inst-1',
      }),
    ).rejects.toThrow('Conecta Gmail primero');
  });

  it('creates a source from sender email and derives the domain', async () => {
    findConnectionByUserEmail.mockResolvedValue({
      id: 'conn-1',
      refreshToken: 'enc',
    });
    findSourceByUserAndInstitution.mockResolvedValue(null);
    createEmailSource.mockResolvedValue(mappedSource);

    await expect(
      service.createEmailSource('user-1', {
        emailAddress: 'me@gmail.com',
        bankSenderEmail: 'alertas@bhd.com.do',
        institutionId: 'inst-1',
      }),
    ).resolves.toMatchObject({
      bankSenderEmail: 'alertas@bhd.com.do',
      bankDomain: 'bhd.com.do',
    });
    expect(createEmailSource).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        connectionId: 'conn-1',
        bankSenderEmails: ['alertas@bhd.com.do'],
        bankDomain: 'bhd.com.do',
      }),
    );
  });

  it('enqueues an incremental Gmail sync when automatic sync is on', async () => {
    const add = jest.fn().mockResolvedValue({});
    users.isFinanceEmailSyncAutomatic.mockResolvedValue(true);
    const queuedService = new IngestionService(
      repo,
      { get: jest.fn() } as never,
      { enqueue: jest.fn() },
      { processBatch: jest.fn() } as never,
      users as never,
      ownership as never,
      { execute: jest.fn() } as never,
      { findLatestCategoryIdByMerchant: jest.fn() } as never,
      { add } as never,
    );
    findConnectionByUserEmail.mockResolvedValue({
      id: 'conn-1',
      refreshToken: 'enc',
    });
    findSourceByUserAndInstitution.mockResolvedValue(null);
    createEmailSource.mockResolvedValue(mappedSource);

    await queuedService.createEmailSource('user-1', {
      emailAddress: 'me@gmail.com',
      bankSenderEmail: 'alertas@bhd.com.do',
      institutionId: 'inst-1',
    });

    expect(add).toHaveBeenCalledWith(
      'gmail-sync-source',
      { userId: 'user-1', sourceId: 'src-1', forceFullSync: false },
      expect.objectContaining({ jobId: 'gmail-sync-src-1' }),
    );
  });

  it('does not enqueue on link when automatic sync is off', async () => {
    const add = jest.fn().mockResolvedValue({});
    const queuedService = new IngestionService(
      repo,
      { get: jest.fn() } as never,
      { enqueue: jest.fn() },
      { processBatch: jest.fn() } as never,
      users as never,
      ownership as never,
      { execute: jest.fn() } as never,
      { findLatestCategoryIdByMerchant: jest.fn() } as never,
      { add } as never,
    );
    findConnectionByUserEmail.mockResolvedValue({
      id: 'conn-1',
      refreshToken: 'enc',
    });
    findSourceByUserAndInstitution.mockResolvedValue(null);
    createEmailSource.mockResolvedValue(mappedSource);

    await queuedService.createEmailSource('user-1', {
      emailAddress: 'me@gmail.com',
      bankSenderEmail: 'alertas@bhd.com.do',
      institutionId: 'inst-1',
    });

    expect(add).not.toHaveBeenCalled();
  });

  it('conflicts when the institution is already linked to another mailbox', async () => {
    findConnectionByUserEmail.mockResolvedValue({
      id: 'conn-2',
      refreshToken: 'enc',
    });
    findSourceByUserAndInstitution.mockResolvedValue({
      ...mappedSource,
      connectionId: 'conn-1',
      isActive: true,
    });

    await expect(
      service.createEmailSource('user-1', {
        emailAddress: 'other@gmail.com',
        bankSenderEmail: 'alertas@bhd.com.do',
        institutionId: 'inst-1',
      }),
    ).rejects.toThrow('This institution is already linked to a mailbox');
  });
});

describe('IngestionService.triggerEmailSync', () => {
  const findEmailSource = jest.fn();
  const repo = { findEmailSource } as unknown as EmailSourceRepository;
  const users = {
    assertFinanceEmailSyncEnabled: jest.fn().mockResolvedValue(undefined),
  };

  function serviceWithQueue(add: jest.Mock) {
    return new IngestionService(
      repo,
      { get: jest.fn() } as never,
      { enqueue: jest.fn() },
      { processBatch: jest.fn() } as never,
      users as never,
      { assertInstitutionOwned: jest.fn() } as never,
      { execute: jest.fn() } as never,
      { findLatestCategoryIdByMerchant: jest.fn() } as never,
      { add } as never,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    findEmailSource.mockResolvedValue({ id: 'src-1', isActive: true });
  });

  it('enqueues a manual sync with the per-source jobId so a retry dedupes', async () => {
    const add = jest.fn().mockResolvedValue({});
    const service = serviceWithQueue(add);

    await expect(service.triggerEmailSync('user-1', 'src-1')).resolves.toEqual({
      queued: true,
    });

    expect(add).toHaveBeenCalledWith(
      'gmail-sync-source',
      { userId: 'user-1', sourceId: 'src-1', forceFullSync: false },
      expect.objectContaining({ jobId: 'gmail-sync-src-1' }),
    );
  });

  it('dedupes a forced full resync with the same per-source jobId', async () => {
    const add = jest.fn().mockResolvedValue({});
    const service = serviceWithQueue(add);

    await expect(
      service.triggerEmailSync('user-1', 'src-1', true),
    ).resolves.toEqual({ queued: true });

    expect(add).toHaveBeenCalledWith(
      'gmail-sync-source',
      { userId: 'user-1', sourceId: 'src-1', forceFullSync: true },
      expect.objectContaining({ jobId: 'gmail-sync-src-1' }),
    );
  });

  it('returns queued false when BullMQ add fails instead of pretending success', async () => {
    const add = jest.fn().mockRejectedValue(new Error('Job already exists'));
    const service = serviceWithQueue(add);

    await expect(service.triggerEmailSync('user-1', 'src-1')).resolves.toEqual({
      queued: false,
      reason: expect.stringContaining('Job already exists'),
    });
  });
});
