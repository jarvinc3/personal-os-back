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
import type { ImportEmailTransactionUseCase } from '../../ledger/application/import-email-transaction.use-case';
import type { LedgerQueryService } from '../../ledger/application/ledger-query.service';
import type { ReverseTransactionUseCase } from '../../ledger/application/reverse-transaction.use-case';
import type { IngestionService } from './ingestion.service';
import { ProcessGmailSyncUseCase } from './process-gmail-sync.use-case';

describe('ProcessGmailSyncUseCase', () => {
  const findEmailSource = jest.fn();
  const createEmailSyncLog = jest.fn();
  const updateEmailSource = jest.fn();
  const completeEmailSyncLog = jest.fn();
  const listCategories = jest.fn();
  const findEmailMessage = jest.fn();
  const upsertEmailMessage = jest.fn();
  const listInstitutionDestinations = jest.fn();
  const emailSources = {
    findEmailSource,
    createEmailSyncLog,
    updateEmailSource,
    completeEmailSyncLog,
    listCategories,
    findEmailMessage,
    upsertEmailMessage,
    listInstitutionDestinations,
  } as unknown as EmailSourceRepository;

  const getValidGmailAccessToken = jest.fn();
  const completeEmailSyncSuccessWithEvent = jest.fn();
  const ingestion = {
    getValidGmailAccessToken,
    completeEmailSyncSuccessWithEvent,
  } as unknown as IngestionService;

  const importExecute = jest.fn();
  const importEmail = {
    execute: importExecute,
  } as unknown as ImportEmailTransactionUseCase;

  const reverseExecute = jest.fn();
  const reverseTx = {
    execute: reverseExecute,
  } as unknown as ReverseTransactionUseCase;

  const findTransactionByEmailMessageId = jest.fn();
  const findReverseCandidates = jest.fn();
  const ledger = {
    findTransactionByEmailMessageId,
    findReverseCandidates,
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
    importEmail,
    reverseTx,
    ledger,
    extractor,
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
      categoryNameHint: null,
      bankStatusRaw: 'APPROVED',
      bankStatusNormalized: 'APPROVED' as const,
      statusEvidence: 'APPROVED',
      statusConfidence: 0.4,
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
    upsertEmailMessage.mockResolvedValue({ id: 'em-row-1' });
    listInstitutionDestinations.mockResolvedValue([
      [{ id: 'acc-1', name: 'Main', accountNumber: '00001234' }],
      [],
    ]);
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

    await useCase.execute({ userId: 'user-1', sourceId: 'src-1' });

    expect(importExecute).not.toHaveBeenCalled();
    expect(upsertEmailMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 'src-1',
        gmailMessageId: 'msg-1',
        outcome: 'PENDING_ASSIGNMENT',
      }),
    );
  });

  it('queues PENDING_ASSIGNMENT when several destinations match', async () => {
    findEmailSource.mockResolvedValue(activeSource);
    listInstitutionDestinations.mockResolvedValue([
      [
        { id: 'acc-1', name: 'A', accountNumber: '11111111' },
        { id: 'acc-2', name: 'B', accountNumber: '22222222' },
      ],
      [],
    ]);
    extract.mockResolvedValue({
      ...transactionExtraction,
      data: {
        ...transactionExtraction.data,
        instrumentHint: null,
        lastFourHint: null,
      },
    });

    await useCase.execute({ userId: 'user-1', sourceId: 'src-1' });

    expect(importExecute).not.toHaveBeenCalled();
    expect(upsertEmailMessage).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'PENDING_ASSIGNMENT' }),
    );
  });

  it('skips import when extractor returns ok false retryable and does not persist', async () => {
    findEmailSource.mockResolvedValue(activeSource);
    extract.mockResolvedValue({
      ok: false,
      reason: 'Model returned invalid JSON',
      retryable: true,
    });

    await useCase.execute({ userId: 'user-1', sourceId: 'src-1' });

    expect(importExecute).not.toHaveBeenCalled();
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
    expect(importExecute).not.toHaveBeenCalled();

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

    expect(importExecute).not.toHaveBeenCalled();
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
    expect(importExecute).not.toHaveBeenCalled();
    expect(completeEmailSyncSuccessWithEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        emailsScanned: 1,
        transactionsNew: 0,
      }),
    );
  });

  it('imports onto the account whose number matches the extracted hint', async () => {
    findEmailSource.mockResolvedValue(activeSource);
    listInstitutionDestinations.mockResolvedValue([
      [
        { id: 'acc-1', name: 'Nomina', accountNumber: '001122335678' },
        { id: 'acc-2', name: 'Ahorros', accountNumber: '998877440000' },
      ],
      [],
    ]);
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
    importExecute.mockResolvedValue({ id: 'tx-1' });

    await useCase.execute({ userId: 'user-1', sourceId: 'src-1' });

    expect(importExecute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        accountId: 'acc-1',
        emailMessageId: 'em-row-1',
      }),
    );
    expect(upsertEmailMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        accountNumberHint: '5678',
        outcome: 'IMPORTED',
      }),
    );
  });

  it('imports PENDING on low confidence, persists IMPORTED, and completes success event', async () => {
    findEmailSource.mockResolvedValue(activeSource);
    extract.mockResolvedValue(transactionExtraction);
    importExecute.mockResolvedValue({ id: 'tx-1' });

    await useCase.execute({ userId: 'user-1', sourceId: 'src-1' });

    expect(importExecute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        emailMessageId: 'em-row-1',
        accountId: 'acc-1',
        status: 'PENDING',
        amount: 12.5,
        currency: 'DOP',
      }),
    );
    expect(upsertEmailMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 'src-1',
        gmailMessageId: 'msg-1',
        outcome: 'IMPORTED',
        provider: 'groq',
        model: 'test',
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

  it('matches CREDIT category hints to INCOME categories only', async () => {
    findEmailSource.mockResolvedValue(activeSource);
    listCategories.mockResolvedValue([
      { id: 'exp-salary', name: 'Salario', type: 'EXPENSE' },
      { id: 'inc-salary', name: 'Salario', type: 'INCOME' },
    ]);
    extract.mockResolvedValue({
      ...transactionExtraction,
      data: {
        ...transactionExtraction.data,
        type: 'CREDIT',
        categoryNameHint: 'Salario',
        statusConfidence: 0.95,
      },
    });
    importExecute.mockResolvedValue({ id: 'tx-income' });

    await useCase.execute({ userId: 'user-1', sourceId: 'src-1' });

    expect(importExecute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        type: 'CREDIT',
        categoryId: 'inc-salary',
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
    });
    extract.mockResolvedValue(transactionExtraction);
    importExecute.mockResolvedValue({ id: 'tx-2' });

    try {
      await useCase.execute({ userId: 'user-1', sourceId: 'src-1' });

      expect(extract).toHaveBeenCalledTimes(1);
      expect(importExecute).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ emailMessageId: 'em-row-1' }),
      );
    } finally {
      if (prev === undefined) {
        delete process.env.MAX_EMAIL_LLM_EXTRACTS;
      } else {
        process.env.MAX_EMAIL_LLM_EXTRACTS = prev;
      }
    }
  });
});
