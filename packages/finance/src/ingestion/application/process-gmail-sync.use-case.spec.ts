jest.mock('../infrastructure/gmail-api.util', () => ({
  listGmailMessages: jest.fn(),
  getGmailMessage: jest.fn(),
  parseGmailMessage: jest.fn(),
}));

import type { EmailTransactionExtractorPort } from './ports/email-transaction-extractor.port';
import type { EmailSourceRepository } from '../infrastructure/email-source.repository';
import {
  getGmailMessage,
  listGmailMessages,
  parseGmailMessage,
} from '../infrastructure/gmail-api.util';
import type { LedgerQueryService } from '../../ledger/application/ledger-query.service';
import type { ReverseTransactionUseCase } from '../../ledger/application/reverse-transaction.use-case';
import type { BackfillPendingEmailUseCase } from './backfill-pending-email.use-case';
import type { MatchEmailTransfersUseCase } from './backfill-pending-email.use-case';
import type { IngestionService } from './ingestion.service';
import { ProcessGmailSyncUseCase } from './process-gmail-sync.use-case';
import type { RouteExtractedEmailUseCase } from './route-extracted-email.use-case';
import type { RetryPendingReversesUseCase } from './retry-pending-reverses.use-case';

describe('ProcessGmailSyncUseCase', () => {
  const findEmailSource = jest.fn();
  const createEmailSyncLog = jest.fn();
  const updateEmailSource = jest.fn();
  const completeEmailSyncLog = jest.fn();
  const listCategories = jest.fn();
  const findEmailMessage = jest.fn();
  const upsertEmailMessage = jest.fn();
  const listInstitutionDestinations = jest.fn();
  const listCashAccounts = jest.fn();
  const emailSources = {
    findEmailSource,
    createEmailSyncLog,
    updateEmailSource,
    completeEmailSyncLog,
    listCategories,
    findEmailMessage,
    upsertEmailMessage,
    listInstitutionDestinations,
    listCashAccounts,
  } as unknown as EmailSourceRepository;

  const getValidGmailAccessToken = jest.fn();
  const completeEmailSyncSuccessWithEvent = jest.fn();
  const ingestion = {
    getValidGmailAccessToken,
    completeEmailSyncSuccessWithEvent,
  } as unknown as IngestionService;

  const routeExecute = jest.fn();
  const routeExtracted = {
    execute: routeExecute,
  } as unknown as RouteExtractedEmailUseCase;
  const backfillExecute = jest.fn().mockResolvedValue({ imported: 0 });
  const backfillPending = {
    execute: backfillExecute,
  } as unknown as BackfillPendingEmailUseCase;
  const matchExecute = jest
    .fn()
    .mockResolvedValue({ paired: 0, atmCompleted: 0 });
  const matchTransfers = {
    execute: matchExecute,
  } as unknown as MatchEmailTransfersUseCase;

  const reverseExecute = jest.fn();
  const reverseTx = {
    execute: reverseExecute,
  } as unknown as ReverseTransactionUseCase;

  const listRetryActions = jest.fn().mockResolvedValue([]);
  const applyRetryAction = jest.fn().mockResolvedValue(undefined);
  const retryPendingReverses = {
    listActions: listRetryActions,
    applyAction: applyRetryAction,
  } as unknown as RetryPendingReversesUseCase;

  const findTransactionByEmailMessageId = jest.fn();
  const findTransactionByExternalReference = jest.fn();
  const findReverseCandidates = jest.fn();
  const findLatestCategoryIdByMerchant = jest.fn();
  const ledger = {
    findTransactionByEmailMessageId,
    findTransactionByExternalReference,
    findReverseCandidates,
    findLatestCategoryIdByMerchant,
  } as unknown as LedgerQueryService;

  const extract = jest.fn();
  const extractor = { extract } as unknown as EmailTransactionExtractorPort;

  const listGmailMessagesMock = listGmailMessages as jest.MockedFunction<
    typeof listGmailMessages
  >;
  const getGmailMessageMock = getGmailMessage as jest.MockedFunction<
    typeof getGmailMessage
  >;
  const parseGmailMessageMock = parseGmailMessage as jest.MockedFunction<
    typeof parseGmailMessage
  >;

  const useCase = new ProcessGmailSyncUseCase(
    emailSources,
    ingestion,
    reverseTx,
    ledger,
    extractor,
    routeExtracted,
    backfillPending,
    matchTransfers,
    retryPendingReverses,
  );

  const activeSource = {
    id: 'src-1',
    isActive: true,
    institutionId: 'inst-1',
    bankSenderEmail: 'alertas@bank.example',
    bankDomain: 'bank.example',
    lastSyncedAt: null,
    lastMessageId: null,
  };

  const transactionExtraction = {
    ok: true as const,
    kind: 'transaction' as const,
    provider: 'groq',
    model: 'test',
    data: {
      amount: 12.5,
      currency: 'DOP',
      type: 'DEBIT' as const,
      transactionDate: '2026-08-01',
      merchant: 'Coffee',
      description: 'Purchase',
      notes: null,
      movementClass: 'PURCHASE' as const,
      categoryNameHint: null,
      bankStatusRaw: 'APPROVED',
      bankStatusNormalized: 'APPROVED' as const,
      statusEvidence: 'APPROVED',
      statusConfidence: 0.4,
      bankReference: null,
      reverseOfEmailMessageId: null,
      reverseOriginalRef: null,
      instrumentHint: 'ACCOUNT' as const,
      lastFourHint: '1234',
      accountNumberHint: null,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    createEmailSyncLog.mockResolvedValue({ id: 'log-1' });
    getValidGmailAccessToken.mockResolvedValue('token');
    listCategories.mockResolvedValue([]);
    findEmailMessage.mockResolvedValue(null);
    findTransactionByEmailMessageId.mockResolvedValue(null);
    findTransactionByExternalReference.mockResolvedValue(null);
    findReverseCandidates.mockResolvedValue([]);
    findLatestCategoryIdByMerchant.mockResolvedValue(null);
    upsertEmailMessage.mockResolvedValue({ id: 'em-row-1' });
    listInstitutionDestinations.mockResolvedValue([
      [{ id: 'acc-1', name: 'Main', accountNumber: '00001234' }],
      [],
    ]);
    listCashAccounts.mockResolvedValue([]);
    routeExecute.mockResolvedValue({
      kind: 'imported',
      transactionId: 'tx-1',
      status: 'PENDING',
    });
    backfillExecute.mockResolvedValue({ imported: 0 });
    listRetryActions.mockResolvedValue([]);
    applyRetryAction.mockResolvedValue(undefined);
    matchExecute.mockResolvedValue({ paired: 0, atmCompleted: 0 });
    updateEmailSource.mockResolvedValue(undefined);
    completeEmailSyncSuccessWithEvent.mockResolvedValue(undefined);
    listGmailMessagesMock.mockResolvedValue({
      messages: [{ id: 'msg-1' }],
      nextPageToken: undefined,
    });
    getGmailMessageMock.mockResolvedValue({ id: 'msg-1' });
    parseGmailMessageMock.mockReturnValue({
      from: 'alerts@bank.example',
      subject: 'Purchase',
      body: 'You spent 12.50 DOP',
      internalDate: null,
    });
  });

  it('lists Gmail with the full sender address when set', async () => {
    findEmailSource.mockResolvedValue(activeSource);
    extract.mockResolvedValue({
      ok: true as const,
      kind: 'not_transaction' as const,
      reason: 'promo',
      provider: 'groq',
      model: 'test',
    });

    await useCase.execute({ userId: 'user-1', sourceId: 'src-1' });

    expect(listGmailMessagesMock).toHaveBeenCalledWith(
      'token',
      'from:alertas@bank.example',
      undefined,
    );
  });

  it('lists Gmail with the domain when sender is missing', async () => {
    findEmailSource.mockResolvedValue({
      ...activeSource,
      bankSenderEmail: null,
    });
    extract.mockResolvedValue({
      ok: true as const,
      kind: 'not_transaction' as const,
      reason: 'promo',
      provider: 'groq',
      model: 'test',
    });

    await useCase.execute({ userId: 'user-1', sourceId: 'src-1' });

    expect(listGmailMessagesMock).toHaveBeenCalledWith(
      'token',
      'from:bank.example',
      undefined,
    );
  });

  it('returns early when source is inactive', async () => {
    findEmailSource.mockResolvedValue({ ...activeSource, isActive: false });

    await useCase.execute({ userId: 'user-1', sourceId: 'src-1' });

    expect(createEmailSyncLog).not.toHaveBeenCalled();
    expect(completeEmailSyncSuccessWithEvent).not.toHaveBeenCalled();
  });

  it('queues PENDING_ASSIGNMENT when no unique ledger target matches', async () => {
    findEmailSource.mockResolvedValue(activeSource);
    listInstitutionDestinations.mockResolvedValue([[], []]);
    extract.mockResolvedValue(transactionExtraction);
    routeExecute.mockResolvedValue({
      kind: 'pending_assignment',
      reason: 'No matching account or card',
    });

    await useCase.execute({ userId: 'user-1', sourceId: 'src-1' });

    expect(routeExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        sourceId: 'src-1',
        gmailMessageId: 'msg-1',
      }),
    );
  });

  it('queues PENDING_ASSIGNMENT when several destinations match', async () => {
    findEmailSource.mockResolvedValue(activeSource);
    extract.mockResolvedValue({
      ...transactionExtraction,
      data: {
        ...transactionExtraction.data,
        instrumentHint: null,
        lastFourHint: null,
      },
    });
    routeExecute.mockResolvedValue({
      kind: 'pending_assignment',
      reason: 'Ambiguous ledger target (2)',
    });

    await useCase.execute({ userId: 'user-1', sourceId: 'src-1' });

    expect(routeExecute).toHaveBeenCalled();
  });

  it('skips import when extractor returns ok false retryable and does not persist', async () => {
    findEmailSource.mockResolvedValue(activeSource);
    extract.mockResolvedValue({
      ok: false,
      reason: 'Model returned invalid JSON',
      retryable: true,
    });

    await useCase.execute({ userId: 'user-1', sourceId: 'src-1' });

    expect(routeExecute).not.toHaveBeenCalled();
    expect(upsertEmailMessage).not.toHaveBeenCalled();
    expect(completeEmailSyncSuccessWithEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        logId: 'log-1',
        userId: 'user-1',
        sourceId: 'src-1',
        emailsScanned: 1,
        transactionsNew: 0,
      }),
    );
  });

  it('persists FAILED_NON_RETRYABLE and skips LLM on second sync', async () => {
    findEmailSource.mockResolvedValue(activeSource);
    extract.mockResolvedValue({
      ok: false,
      reason: 'Extracted payload failed schema validation',
      retryable: false,
    });

    await useCase.execute({ userId: 'user-1', sourceId: 'src-1' });

    expect(upsertEmailMessage).toHaveBeenCalledWith({
      sourceId: 'src-1',
      gmailMessageId: 'msg-1',
      outcome: 'FAILED_NON_RETRYABLE',
      reason: 'Extracted payload failed schema validation',
    });
    expect(routeExecute).not.toHaveBeenCalled();

    extract.mockClear();
    findEmailMessage.mockResolvedValue({
      id: 'em-1',
      outcome: 'FAILED_NON_RETRYABLE',
    });

    await useCase.execute({ userId: 'user-1', sourceId: 'src-1' });

    expect(extract).not.toHaveBeenCalled();
    expect(getGmailMessageMock).toHaveBeenCalledTimes(1);
  });

  it('persists SKIPPED_NOT_TX for promo and does not import', async () => {
    findEmailSource.mockResolvedValue(activeSource);
    extract.mockResolvedValue({
      ok: true,
      kind: 'not_transaction',
      reason: 'Promotional newsletter',
      provider: 'groq',
      model: 'test',
    });

    await useCase.execute({ userId: 'user-1', sourceId: 'src-1' });

    expect(routeExecute).not.toHaveBeenCalled();
    expect(upsertEmailMessage).toHaveBeenCalledWith({
      sourceId: 'src-1',
      gmailMessageId: 'msg-1',
      outcome: 'SKIPPED_NOT_TX',
      reason: 'Promotional newsletter',
      provider: 'groq',
      model: 'test',
    });
  });

  it('does not call extractor on second sync when message already skipped', async () => {
    findEmailSource.mockResolvedValue(activeSource);
    findEmailMessage.mockResolvedValue({
      id: 'em-1',
      outcome: 'SKIPPED_NOT_TX',
    });

    await useCase.execute({ userId: 'user-1', sourceId: 'src-1' });

    expect(extract).not.toHaveBeenCalled();
    expect(getGmailMessageMock).not.toHaveBeenCalled();
    expect(routeExecute).not.toHaveBeenCalled();
    expect(completeEmailSyncSuccessWithEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        emailsScanned: 1,
        transactionsNew: 0,
      }),
    );
  });

  it('imports onto the account whose number matches the extracted hint', async () => {
    findEmailSource.mockResolvedValue(activeSource);
    extract.mockResolvedValue({
      ...transactionExtraction,
      data: {
        ...transactionExtraction.data,
        type: 'CREDIT',
        instrumentHint: 'ACCOUNT',
        lastFourHint: null,
        accountNumberHint: '5678',
      },
    });
    routeExecute.mockResolvedValue({
      kind: 'imported',
      transactionId: 'tx-1',
      status: 'CONFIRMED',
    });

    await useCase.execute({ userId: 'user-1', sourceId: 'src-1' });

    expect(routeExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        extracted: expect.objectContaining({
          accountNumberHint: '5678',
          type: 'CREDIT',
        }),
      }),
    );
  });

  it('imports PENDING on low confidence, persists IMPORTED, and completes success event', async () => {
    findEmailSource.mockResolvedValue(activeSource);
    extract.mockResolvedValue(transactionExtraction);
    routeExecute.mockResolvedValue({
      kind: 'imported',
      transactionId: 'tx-1',
      status: 'PENDING',
    });

    await useCase.execute({ userId: 'user-1', sourceId: 'src-1' });

    expect(routeExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        extracted: expect.objectContaining({
          amount: 12.5,
          currency: 'DOP',
        }),
      }),
    );
    expect(completeEmailSyncSuccessWithEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        logId: 'log-1',
        userId: 'user-1',
        sourceId: 'src-1',
        emailsScanned: 1,
        transactionsNew: 1,
        transactionIds: ['tx-1'],
      }),
    );
  });

  it('passes categories to the extractor', async () => {
    findEmailSource.mockResolvedValue(activeSource);
    listCategories.mockResolvedValue([
      { id: 'exp-food', name: 'Alimentación', type: 'EXPENSE' },
      { id: 'exp-transport', name: 'Transporte', type: 'EXPENSE' },
    ]);
    extract.mockResolvedValue({
      ...transactionExtraction,
      data: {
        ...transactionExtraction.data,
        merchant: 'Uber',
        categoryNameHint: null,
        notes: 'Revisa si fue transporte.',
        statusConfidence: 0.95,
      },
    });
    routeExecute.mockResolvedValue({
      kind: 'imported',
      transactionId: 'tx-hist',
      status: 'CONFIRMED',
    });

    await useCase.execute({ userId: 'user-1', sourceId: 'src-1' });

    expect(extract).toHaveBeenCalledWith(
      expect.objectContaining({
        categories: [
          { name: 'Alimentación', type: 'EXPENSE' },
          { name: 'Transporte', type: 'EXPENSE' },
        ],
      }),
    );
  });

  it('does not count persisted skips toward the LLM extract cap', async () => {
    const prev = process.env.MAX_EMAIL_LLM_EXTRACTS;
    process.env.MAX_EMAIL_LLM_EXTRACTS = '1';

    findEmailSource.mockResolvedValue(activeSource);
    listGmailMessagesMock.mockResolvedValue({
      messages: [{ id: 'msg-skip' }, { id: 'msg-new' }],
      nextPageToken: undefined,
    });
    findEmailMessage.mockImplementation((_sourceId, gmailMessageId) =>
      gmailMessageId === 'msg-skip'
        ? { id: 'em-skip', outcome: 'SKIPPED_NOT_TX' }
        : null,
    );
    getGmailMessageMock.mockResolvedValue({ id: 'msg-new' });
    parseGmailMessageMock.mockReturnValue({
      from: 'alerts@bank.example',
      subject: 'Purchase',
      body: 'You spent 12.50 DOP',
      internalDate: null,
    });
    extract.mockResolvedValue(transactionExtraction);
    routeExecute.mockResolvedValue({
      kind: 'imported',
      transactionId: 'tx-2',
      status: 'PENDING',
    });

    try {
      await useCase.execute({ userId: 'user-1', sourceId: 'src-1' });

      expect(extract).toHaveBeenCalledTimes(1);
      expect(routeExecute).toHaveBeenCalledWith(
        expect.objectContaining({ gmailMessageId: 'msg-new' }),
      );
    } finally {
      if (prev === undefined) {
        delete process.env.MAX_EMAIL_LLM_EXTRACTS;
      } else {
        process.env.MAX_EMAIL_LLM_EXTRACTS = prev;
      }
    }
  });

  it('does not advance lastSyncedAt when the LLM extract cap defers remaining mail', async () => {
    const prev = process.env.MAX_EMAIL_LLM_EXTRACTS;
    process.env.MAX_EMAIL_LLM_EXTRACTS = '1';

    findEmailSource.mockResolvedValue(activeSource);
    listGmailMessagesMock.mockResolvedValue({
      messages: [{ id: 'msg-1' }, { id: 'msg-2' }],
      nextPageToken: undefined,
    });
    extract.mockResolvedValue(transactionExtraction);
    routeExecute.mockResolvedValue({
      kind: 'imported',
      transactionId: 'tx-1',
      status: 'PENDING',
    });

    try {
      await useCase.execute({ userId: 'user-1', sourceId: 'src-1' });

      expect(extract).toHaveBeenCalledTimes(1);
      expect(updateEmailSource).not.toHaveBeenCalledWith(
        'user-1',
        'src-1',
        expect.objectContaining({ lastSyncedAt: expect.any(Date) }),
      );
      expect(completeEmailSyncSuccessWithEvent).toHaveBeenCalled();
    } finally {
      if (prev === undefined) {
        delete process.env.MAX_EMAIL_LLM_EXTRACTS;
      } else {
        process.env.MAX_EMAIL_LLM_EXTRACTS = prev;
      }
    }
  });

  it('does not advance lastSyncedAt when an extract is retryable', async () => {
    findEmailSource.mockResolvedValue(activeSource);
    extract.mockResolvedValue({
      ok: false,
      retryable: true,
      reason: 'provider_overloaded',
    });

    await useCase.execute({ userId: 'user-1', sourceId: 'src-1' });

    expect(upsertEmailMessage).not.toHaveBeenCalled();
    expect(updateEmailSource).not.toHaveBeenCalledWith(
      'user-1',
      'src-1',
      expect.objectContaining({ lastSyncedAt: expect.any(Date) }),
    );
  });

  it('counts a routed duplicate as skipped, not imported', async () => {
    findEmailSource.mockResolvedValue(activeSource);
    extract.mockResolvedValue(transactionExtraction);
    routeExecute.mockResolvedValue({
      kind: 'duplicate',
      transactionId: 'tx-existing',
    });

    await useCase.execute({ userId: 'user-1', sourceId: 'src-1' });

    expect(completeEmailSyncSuccessWithEvent).toHaveBeenCalledWith(
      expect.objectContaining({ transactionsNew: 0 }),
    );
  });

  it('records a per-message import failure and keeps processing the batch', async () => {
    findEmailSource.mockResolvedValue(activeSource);
    extract.mockResolvedValue(transactionExtraction);
    routeExecute.mockRejectedValue(
      new Error('Exchange rate unavailable for RDS->DOP on 2026-08-01'),
    );

    await expect(
      useCase.execute({ userId: 'user-1', sourceId: 'src-1' }),
    ).resolves.toBeUndefined();

    expect(upsertEmailMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        gmailMessageId: 'msg-1',
        outcome: 'FAILED_NON_RETRYABLE',
        reason: expect.stringContaining('Exchange rate unavailable'),
      }),
    );
    expect(completeEmailSyncSuccessWithEvent).toHaveBeenCalled();
  });

  it('fails the job when Gmail cannot read the message', async () => {
    findEmailSource.mockResolvedValue(activeSource);
    extract.mockResolvedValue(transactionExtraction);
    getGmailMessageMock.mockRejectedValue(new Error('Gmail 503'));

    await expect(
      useCase.execute({ userId: 'user-1', sourceId: 'src-1' }),
    ).rejects.toThrow('Gmail 503');

    expect(completeEmailSyncLog).toHaveBeenCalledWith(
      'log-1',
      expect.objectContaining({ status: 'FAILED' }),
    );
  });

  it('marks a repeated reversal as SKIPPED_DUPLICATE', async () => {
    findEmailSource.mockResolvedValue(activeSource);
    extract.mockResolvedValue({
      ...transactionExtraction,
      data: {
        ...transactionExtraction.data,
        bankStatusNormalized: 'REVERSED',
        statusConfidence: 0.95,
      },
    });
    findReverseCandidates
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'tx-original', userId: 'user-1', status: 'REVERSED' },
      ]);

    await useCase.execute({ userId: 'user-1', sourceId: 'src-1' });

    expect(reverseExecute).not.toHaveBeenCalled();
    expect(upsertEmailMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        gmailMessageId: 'msg-1',
        outcome: 'SKIPPED_DUPLICATE',
      }),
    );
  });

  it('persists PENDING_REVERSE when no original is found', async () => {
    findEmailSource.mockResolvedValue(activeSource);
    extract.mockResolvedValue({
      ...transactionExtraction,
      data: {
        ...transactionExtraction.data,
        bankStatusNormalized: 'REVERSED',
        statusConfidence: 0.95,
      },
    });
    findReverseCandidates.mockResolvedValue([]);

    await useCase.execute({ userId: 'user-1', sourceId: 'src-1' });

    expect(reverseExecute).not.toHaveBeenCalled();
    expect(upsertEmailMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        gmailMessageId: 'msg-1',
        outcome: 'PENDING_REVERSE',
      }),
    );
  });

  it('counts reversals applied by the pending retry pass', async () => {
    findEmailSource.mockResolvedValue(activeSource);
    extract.mockResolvedValue({
      ok: true as const,
      kind: 'not_transaction' as const,
      reason: 'promo',
      provider: 'groq',
      model: 'test',
    });
    listRetryActions.mockResolvedValue([
      {
        kind: 'apply',
        sourceId: 'src-1',
        gmailMessageId: 'msg-9',
        originalId: 'tx-9',
        extracted: transactionExtraction.data,
        provider: null,
        model: null,
      },
    ]);

    await useCase.execute({ userId: 'user-1', sourceId: 'src-1' });

    expect(applyRetryAction).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ kind: 'apply', originalId: 'tx-9' }),
    );
    expect(completeEmailSyncSuccessWithEvent).toHaveBeenCalledWith(
      expect.objectContaining({ transactionsNew: 1, transactionIds: ['tx-9'] }),
    );
  });

  it('does not count retry actions that only mark duplicates', async () => {
    findEmailSource.mockResolvedValue(activeSource);
    extract.mockResolvedValue({
      ok: true as const,
      kind: 'not_transaction' as const,
      reason: 'promo',
      provider: 'groq',
      model: 'test',
    });
    listRetryActions.mockResolvedValue([
      {
        kind: 'duplicate',
        sourceId: 'src-1',
        gmailMessageId: 'msg-9',
        originalId: 'tx-9',
        provider: null,
        model: null,
      },
    ]);

    await useCase.execute({ userId: 'user-1', sourceId: 'src-1' });

    expect(applyRetryAction).toHaveBeenCalled();
    expect(completeEmailSyncSuccessWithEvent).toHaveBeenCalledWith(
      expect.objectContaining({ transactionsNew: 0 }),
    );
  });
});
