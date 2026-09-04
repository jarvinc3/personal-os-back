import type { ConfigService } from '@nestjs/config';
import { AppEvents } from '../../../../core/events/event.constants';
import type { DomainEventPublisherPort } from '../../events/application/ports/domain-event-publisher.port';
import type { FinanceOutboxDispatcher } from '../../events/infrastructure/finance-outbox.dispatcher';
import type { EmailSourceRepository } from '../infrastructure/email-source.repository';
import { IngestionService } from './ingestion.service';

describe('IngestionService.completeEmailSyncSuccessWithEvent', () => {
  it('enqueues finance.email_sync.completed via same-TX outbox helper', async () => {
    const completeEmailSyncSuccessWithOutbox = jest.fn().mockResolvedValue(undefined);
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

describe('IngestionService pending assignment', () => {
  const listPendingAssignmentMessages = jest.fn();
  const findEmailMessageById = jest.fn();
  const listCategories = jest.fn();
  const listInstitutionDestinations = jest.fn();
  const upsertEmailMessage = jest.fn();
  const repo = {
    listPendingAssignmentMessages,
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

  const service = new IngestionService(
    repo,
    { get: jest.fn() } as never,
    { enqueue: jest.fn() },
    { processBatch: jest.fn() } as never,
    users as never,
    ownership as never,
    importEmail as never,
    undefined,
  );

  const pendingMessage = {
    id: 'em-1',
    sourceId: 'src-1',
    gmailMessageId: 'msg-1',
    outcome: 'PENDING_ASSIGNMENT' as const,
    instrumentHint: 'ACCOUNT',
    lastFourHint: '1234',
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
    listPendingAssignmentMessages.mockResolvedValue([pendingMessage]);
    await expect(service.listPendingAssignment('user-1')).resolves.toEqual([
      expect.objectContaining({
        id: 'em-1',
        institutionId: 'inst-1',
        lastFourHint: '1234',
      }),
    ]);
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
    findEmailMessageById.mockResolvedValue(pendingMessage);
    listInstitutionDestinations.mockResolvedValue([
      [{ id: 'acc-1' }, { id: 'acc-2' }],
      [],
    ]);

    await expect(
      service.retryPendingMessage('user-1', 'em-1'),
    ).resolves.toMatchObject({ id: 'em-1', institutionId: 'inst-1' });
    expect(importEmail.execute).not.toHaveBeenCalled();
  });
});
