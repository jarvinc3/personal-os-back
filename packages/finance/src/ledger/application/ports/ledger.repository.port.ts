import type { BudgetSpendSnapshot } from '../../../shared/domain/budget-snapshot';
import type { StoredMovement } from '../../../shared/domain/deletion-snapshot';
import type { RestoreResult } from '../../../shared/domain/deletion-snapshot';
import type { ResolvedAmounts } from '../../../shared/domain/money';
import type { TransactionLinkKind } from '../../../shared/domain/transaction-links';
import type {
  CreateCardPaymentCommand,
  CreateTransactionCommand,
  CreateTransferCommand,
  FinTxStatus,
  ImportEmailTransactionCommand,
  ListTransactionsQuery,
  TransactionUpdateFields,
} from '../commands/ledger.commands';

/** Transaction with optional account/card labels (list/get shape). */
export type LedgerTransactionRow = {
  id: string;
  userId: string;
  accountId: string | null;
  cardId: string | null;
  type: string;
  amount: { toString(): string } | number;
  ledgerAmount?: { toString(): string } | number | null;
  amountBaseCurrency?: { toString(): string } | number | null;
  currency: string;
  ledgerCurrency?: string | null;
  exchangeRate?: { toString(): string } | number | null;
  merchant: string | null;
  description: string | null;
  notes: string | null;
  categoryId: string | null;
  status: string;
  source: string;
  legRole?: string | null;
  rail?: string | null;
  transferGroupId: string | null;
  linkedTransactionId: string | null;
  possibleDuplicateOfId?: string | null;
  emailMessageId?: string | null;
  aiMetadata?: unknown;
  transactionDate: Date;
  createdAt: Date;
  account?: {
    id: string;
    name: string;
    institutionRef?: {
      logoUrl?: string | null;
      logoPath?: string | null;
      customLogoPath?: string | null;
    } | null;
  } | null;
  card?: {
    id: string;
    name: string;
    network?: string | null;
    institution?: {
      logoUrl?: string | null;
      logoPath?: string | null;
      customLogoPath?: string | null;
    } | null;
  } | null;
  transferCounterpart?: LedgerTransactionRow | null;
};

export type CreateTransactionResult = {
  transaction: LedgerTransactionRow;
  budgetSnapshots: BudgetSpendSnapshot[];
};

export type CreateTransferResult = {
  debit: LedgerTransactionRow;
  credit: LedgerTransactionRow;
  fee?: LedgerTransactionRow;
  transferGroupId: string;
};

export type BalanceAdjustmentTarget = {
  accountId: string | null;
  cardId: string | null;
  currency: string;
  currentBalance: number;
};

/**
 * Persistence port for ledger reads and multi-step writes
 * (balance + budget spent + outbox inside the same transaction).
 */
export interface LedgerRepositoryPort {
  findTransactions(
    userId: string,
    query: ListTransactionsQuery,
  ): Promise<LedgerTransactionRow[]>;

  findTransactionById(
    id: string,
    userId: string,
  ): Promise<LedgerTransactionRow | null>;

  clearPossibleDuplicate(userId: string, id: string): Promise<void>;

  /** Which planning record points at this movement, if any. */
  findPlanningLinkKind(
    transactionId: string,
    userId: string,
  ): Promise<TransactionLinkKind | null>;

  findAccountById(
    id: string,
    userId: string,
  ): Promise<{ id: string; currency: string } | null>;

  findTransactionByEmailMessageId(
    gmailMessageId: string,
    userId?: string,
  ): Promise<LedgerTransactionRow | null>;

  findTransactionByExternalReference(
    userId: string,
    reference: string,
  ): Promise<LedgerTransactionRow | null>;

  findTransactionsByTransferGroupId(
    transferGroupId: string,
    userId: string,
  ): Promise<LedgerTransactionRow[]>;

  findTransactionsByTransferGroupIds(
    userId: string,
    transferGroupIds: string[],
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

  createBalanceAdjustment(
    userId: string,
    input: {
      accountId?: string | null;
      cardId?: string | null;
      amounts: ResolvedAmounts;
    },
  ): Promise<CreateTransactionResult | null>;

  createTransaction(
    userId: string,
    command: CreateTransactionCommand,
    amounts: ResolvedAmounts,
    source?: 'MANUAL' | 'EMAIL' | 'AI',
    extras?: {
      emailMessageId?: string;
      aiMetadata?: unknown;
      linkedTransactionId?: string;
      transferGroupId?: string;
    },
  ): Promise<CreateTransactionResult | null>;

  createTransfer(input: {
    userId: string;
    command: CreateTransferCommand;
    fromAmounts: ResolvedAmounts;
    toAmounts: ResolvedAmounts;
    feeAmounts?: ResolvedAmounts;
  }): Promise<CreateTransferResult | null>;

  /** A card payment is two CARD_PAYMENT legs: account out, card available up. */
  createCardPayment(input: {
    userId: string;
    command: CreateCardPaymentCommand;
    fromAmounts: ResolvedAmounts;
    toAmounts: ResolvedAmounts;
  }): Promise<CreateTransferResult | null>;

  findCardForPayment(
    userId: string,
    cardId: string,
  ): Promise<{ id: string; type: string; currencies: string[] } | null>;

  /** Replaces both legs (and the fee effect) inside one transaction. */
  updateTransfer(input: {
    userId: string;
    debitId: string;
    creditId: string;
    debitTarget: { accountId: string | null; cardId: string | null };
    creditTarget: { accountId: string | null; cardId: string | null };
    fromAmounts: ResolvedAmounts;
    toAmounts: ResolvedAmounts;
    transactionDate: Date;
    description?: string | null;
    notes?: string | null;
    /** When present, updates the FEE leg (creating it if the transfer had none). */
    feeAmounts?: ResolvedAmounts;
    feeCategoryId?: string | null;
  }): Promise<{
    debit: LedgerTransactionRow;
    credit: LedgerTransactionRow;
  } | null>;

  unconfirmTransactionsByTransferGroupId(
    userId: string,
    transferGroupId: string,
  ): Promise<{ count: number }>;

  updateTransaction(
    userId: string,
    id: string,
    data: TransactionUpdateFields,
  ): Promise<CreateTransactionResult | null>;

  deleteTransaction(userId: string, id: string): Promise<{ count: number }>;

  restoreTransaction(
    userId: string,
    id: string,
    now: Date,
  ): Promise<RestoreResult>;

  deleteTransactionsByTransferGroupId(
    userId: string,
    transferGroupId: string,
  ): Promise<{ count: number }>;

  purgeLedgerForAccount(
    userId: string,
    accountId: string,
  ): Promise<{ count: number; rows: LedgerTransactionRow[] }>;

  purgeLedgerForCard(
    userId: string,
    cardId: string,
  ): Promise<{ count: number; rows: LedgerTransactionRow[] }>;

  /** Puts the balance and budget effect of movements a delete reversed. */
  restoreLedgerTransactions(
    userId: string,
    movements: readonly StoredMovement[],
  ): Promise<{ count: number }>;

  confirmTransaction(
    userId: string,
    id: string,
  ): Promise<CreateTransactionResult | null>;

  /** Reverts balance and budget effect and moves a CONFIRMED movement to PENDING. */
  unconfirmTransaction(
    userId: string,
    id: string,
  ): Promise<CreateTransactionResult | null>;

  confirmTransactionsByTransferGroupId(
    userId: string,
    transferGroupId: string,
  ): Promise<{ count: number; budgetSnapshots: BudgetSpendSnapshot[] }>;

  reverseTransaction(
    userId: string,
    originalId: string,
    aiMetadata?: unknown,
  ): Promise<CreateTransactionResult | null>;

  createEmailImportTransaction(
    userId: string,
    data: ImportEmailTransactionCommand,
  ): Promise<LedgerTransactionRow>;

  pairEmailTransferLegs(
    userId: string,
    debitId: string,
    creditId: string,
  ): Promise<CreateTransferResult | null>;

  addEmailTransferCounterpart(
    userId: string,
    existingId: string,
    counterpart: {
      accountId?: string;
      cardId?: string;
      amounts: ResolvedAmounts;
      description?: string | null;
      notes?: string | null;
      status: FinTxStatus;
      emailMessageId?: string;
      aiMetadata?: unknown;
    },
  ): Promise<CreateTransferResult | null>;
}
