import type { TransactionLinkKind } from '../../../shared/domain/transaction-links';
import type {
  FinTxStatus,
  ListTransactionsQuery,
} from '../commands/ledger.commands';
import type {
  BalanceAdjustmentTarget,
  CardLedgerContext,
  LedgerTransactionRow,
} from './ledger.repository.port';

/** Lecturas del ledger: movimientos, destinos y candidatos. */
export interface LedgerQueryRepositoryPort {
  findTransactions(
    userId: string,
    query: ListTransactionsQuery,
  ): Promise<LedgerTransactionRow[]>;

  findTransactionById(
    id: string,
    userId: string,
  ): Promise<LedgerTransactionRow | null>;

  /** Which planning record points at this movement, if any. */
  findPlanningLinkKind(
    transactionId: string,
    userId: string,
  ): Promise<TransactionLinkKind | null>;

  findAccountById(
    id: string,
    userId: string,
  ): Promise<{ id: string; currency: string } | null>;

  /** Card with the currencies it declares, for the ledger target of a movement. */
  findCardLedgerContext(
    id: string,
    userId: string,
  ): Promise<CardLedgerContext | null>;

  /** Savings goal that earmarks this account, if any. */
  findSavingsGoalIdByAccount(
    userId: string,
    accountId: string,
  ): Promise<string | null>;

  findTransactionByImportReference(
    importReference: string,
    userId: string,
  ): Promise<LedgerTransactionRow | null>;

  findTransactionByExternalReference(
    userId: string,
    reference: string,
  ): Promise<LedgerTransactionRow | null>;

  findTransactionsByExternalReference(
    userId: string,
    reference: string,
  ): Promise<LedgerTransactionRow[]>;

  findTransactionsByTransferGroupId(
    transferGroupId: string,
    userId: string,
  ): Promise<LedgerTransactionRow[]>;

  findTransactionsByTransferGroupIds(
    userId: string,
    transferGroupIds: string[],
  ): Promise<LedgerTransactionRow[]>;

  findTransactionsByIds(
    userId: string,
    ids: readonly string[],
  ): Promise<LedgerTransactionRow[]>;

  findCandidatesForReverse(
    userId: string,
    params: {
      amount: number;
      currency: string;
      merchant: string | null;
      aroundDate: Date;
      statuses?: FinTxStatus[];
    },
  ): Promise<LedgerTransactionRow[]>;

  findReverseCandidatesByCard(
    userId: string,
    params: {
      amount: number;
      currency: string;
      cardId: string;
      accountId: string | null;
      from: Date;
      to: Date;
      statuses?: FinTxStatus[];
    },
  ): Promise<LedgerTransactionRow[]>;

  findImportedTransactionByEmailMessageId(
    userId: string,
    messageId: string,
  ): Promise<LedgerTransactionRow | null>;

  findLinkedRefundTotal(params: {
    userId: string;
    originalId: string;
    currency: string;
  }): Promise<number>;

  findDedupeCandidate(
    userId: string,
    params: {
      externalReference: string | null;
      accountId?: string | null;
      cardId?: string | null;
      amount: number;
      currency: string;
      type: 'DEBIT' | 'CREDIT';
      merchant: string | null;
      transactionDate: Date;
    },
  ): Promise<LedgerTransactionRow | null>;

  findPossibleDuplicate(
    userId: string,
    params: {
      accountId?: string | null;
      cardId?: string | null;
      amount: number;
      currency: string;
      type: 'DEBIT' | 'CREDIT';
      transactionDate: Date;
    },
  ): Promise<LedgerTransactionRow | null>;

  /** Most recent categorized CONFIRMED tx for the same merchant (case-insensitive). */
  findLatestCategoryIdByMerchant(
    userId: string,
    merchant: string,
  ): Promise<string | null>;

  findBalanceAdjustmentTarget(
    userId: string,
    input: { accountId?: string; cardId?: string; currency?: string },
  ): Promise<BalanceAdjustmentTarget | null>;
}
