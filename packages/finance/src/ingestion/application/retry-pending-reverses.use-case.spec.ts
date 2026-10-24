import type { LedgerQueryService } from '../../ledger/application/ledger-query.service';
import type { ReverseTransactionUseCase } from '../../ledger/application/reverse-transaction.use-case';
import type { ExtractedEmailTransaction } from './ports/email-transaction-extractor.port';
import type { FinancialImportCandidatesPort } from './ports/financial-import-candidates.port';
import {
  RetryPendingReversesUseCase,
  type PendingReversalAction,
} from './retry-pending-reverses.use-case';

describe('RetryPendingReversesUseCase', () => {
  const listPendingReversalCandidates = jest.fn();
  const persistCandidate = jest.fn();
  const emailSources = {
    listPendingReversalCandidates,
    persistCandidate,
  } as unknown as FinancialImportCandidatesPort;

  const findTransactionByExternalReference = jest.fn();
  const findTransactionByImportReference = jest.fn();
  const findReverseCandidates = jest.fn();
  const ledger = {
    findTransactionByExternalReference,
    findTransactionByImportReference,
    findReverseCandidates,
  } as unknown as LedgerQueryService;

  const reverseExecute = jest.fn();
  const reverseTx = {
    execute: reverseExecute,
  } as unknown as ReverseTransactionUseCase;

  const useCase = new RetryPendingReversesUseCase(
    emailSources,
    ledger,
    reverseTx,
  );

  const extractedPayload: ExtractedEmailTransaction = {
    amount: 25,
    currency: 'DOP',
    type: 'DEBIT',
    transactionDate: '2026-09-20T10:00:00.000Z',
    merchant: 'Uber',
    description: 'Reverso de viaje',
    notes: null,
    movementClass: 'OTHER',
    categoryNameHint: null,
    bankStatusRaw: 'REVERSED',
    bankStatusNormalized: 'REVERSED',
    statusEvidence: 'REVERSED',
    statusConfidence: 0.95,
    bankReference: null,
    reverseOfEmailMessageId: null,
    reverseOriginalRef: null,
    instrumentHint: 'CARD',
    lastFourHint: '1234',
    accountNumberHint: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    findTransactionByExternalReference.mockResolvedValue(null);
    findTransactionByImportReference.mockResolvedValue(null);
    findReverseCandidates.mockResolvedValue([]);
    reverseExecute.mockResolvedValue(undefined);
    persistCandidate.mockResolvedValue({ id: 'em-1' });
  });

  it('plans an apply action when the original is still confirmed', async () => {
    listPendingReversalCandidates.mockResolvedValue([
      {
        sourceId: 'src-1',
        sourceReference: 'msg-1',
        provider: 'groq',
        model: 'test',
        extractedPayload,
      },
    ]);
    findReverseCandidates.mockResolvedValueOnce([
      { id: 'tx-1', userId: 'user-1', status: 'CONFIRMED' },
    ]);

    const actions = await useCase.listActions('user-1');

    expect(actions).toEqual([
      expect.objectContaining({ kind: 'apply', originalId: 'tx-1' }),
    ]);
  });

  it('plans a duplicate action when the original is already reversed', async () => {
    listPendingReversalCandidates.mockResolvedValue([
      {
        sourceId: 'src-1',
        sourceReference: 'msg-1',
        provider: null,
        model: null,
        extractedPayload,
      },
    ]);
    findReverseCandidates
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'tx-1', userId: 'user-1', status: 'REVERSED' },
      ]);

    const actions = await useCase.listActions('user-1');

    expect(actions).toEqual([
      expect.objectContaining({ kind: 'duplicate', originalId: 'tx-1' }),
    ]);
  });

  it('plans an unusable action when the stored payload is missing', async () => {
    listPendingReversalCandidates.mockResolvedValue([
      {
        sourceId: 'src-1',
        sourceReference: 'msg-1',
        provider: null,
        model: null,
        extractedPayload: null,
      },
    ]);

    const actions = await useCase.listActions('user-1');

    expect(actions).toEqual([expect.objectContaining({ kind: 'unusable' })]);
  });

  it('applies a planned reversal and marks the email as imported', async () => {
    const action: PendingReversalAction = {
      kind: 'apply',
      sourceId: 'src-1',
      sourceReference: 'msg-1',
      originalId: 'tx-1',
      extracted: extractedPayload,
      provider: 'groq',
      model: 'test',
    };

    await useCase.applyAction('user-1', action);

    expect(reverseExecute).toHaveBeenCalledWith(
      'user-1',
      'tx-1',
      expect.objectContaining({ reverseEmailMessageId: 'msg-1' }),
    );
    expect(persistCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceReference: 'msg-1',
        outcome: 'IMPORTED',
      }),
    );
  });
});
