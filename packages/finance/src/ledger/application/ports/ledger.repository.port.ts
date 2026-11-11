import type { BudgetSpendSnapshot } from '../../../shared/domain/budget-snapshot';
import type {
  RestoreResult,
  StoredMovement,
} from '../../../shared/domain/deletion-snapshot';
import type { LedgerCardType } from '../../../shared/domain/ledger-rules';
import type { ResolvedAmounts } from '../../../shared/domain/money';
import type { TransactionLinkKind } from '../../../shared/domain/transaction-links';
import type {
  CardPaymentImportDecision,
  IncomingCardPayment,
} from '../reconcile-card-payment-import';
import type {
  CreateCardPaymentCommand,
  CreateTransactionCommand,
  CreateTransferCommand,
  FinTxStatus,
  ImportFinancialTransactionCommand,
  ListTransactionsQuery,
  TransactionUpdateFields,
} from '../commands/ledger.commands';

/** Resultado de un pago importado: escribe, vincula o deja en revisión. */
export type ImportedCardPaymentOutcome =
  | {
      kind: 'created';
      transferGroupId: string;
      sourceTransactionId: string;
      cardTransactionId: string;
    }
  | {
      kind: 'duplicate';
      transferGroupId: string;
      sourceTransactionId: string;
    }
  | {
      kind: 'review';
      reason:
        | 'CARD_PAYMENT_REFERENCE_CONFLICT'
        | 'CARD_PAYMENT_RECONCILIATION_AMBIGUOUS';
      candidateTransactionIds: string[];
    }
  | { kind: 'not_written' };

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
  isEstimated?: boolean;
  merchant: string | null;
  merchantId?: string | null;
  merchantRef?: {
    id: string;
    name: string;
    logoUrl: string | null;
  } | null;
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
  importReference?: string | null;
  aiMetadata?: unknown;
  loanInstallment?: {
    id: string;
    installmentNo: number;
    loan?: { lenderName: string } | null;
  } | null;
  receivablePayment?: {
    id: string;
    receivable?: { debtorName: string } | null;
  } | null;
  savingsGoalContribution?: {
    id: string;
    goal?: { name: string } | null;
  } | null;
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

/** The leg an imported movement creates on the other side of a transfer. */
export type ImportedTransferCounterpart = {
  accountId?: string;
  cardId?: string;
  amounts: ResolvedAmounts;
  description?: string | null;
  notes?: string | null;
  status: FinTxStatus;
  importReference?: string;
  aiMetadata?: unknown;
};

/** Card a movement targets, with the currencies the card already declares. */
export type CardLedgerContext = {
  cardType: LedgerCardType;
  accountId: string | null;
  currencies: string[];
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

  createBalanceAdjustment(
    userId: string,
    input: {
      accountId?: string | null;
      cardId?: string | null;
      amounts: ResolvedAmounts;
      description?: string;
      transactionDate?: Date;
    },
  ): Promise<CreateTransactionResult | null>;

  createTransaction(
    userId: string,
    command: CreateTransactionCommand,
    amounts: ResolvedAmounts,
    source?: 'MANUAL' | 'EMAIL' | 'AI',
    extras?: {
      importReference?: string;
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
    estimated: boolean;
  }): Promise<CreateTransferResult | null>;

  /** A card payment is two CARD_PAYMENT legs: account out, card available up. */
  createCardPayment(input: {
    userId: string;
    command: CreateCardPaymentCommand;
    fromAmounts: ResolvedAmounts;
    toAmounts: ResolvedAmounts;
  }): Promise<CreateTransferResult | null>;

  /**
   * Igual que `createCardPayment`, pero decide dentro de la misma transacción
   * con un bloqueo por usuario: dos correos simultáneos con la misma operación
   * no pueden crear dos pagos.
   */
  createImportedCardPayment(input: {
    userId: string;
    command: CreateCardPaymentCommand;
    fromAmounts: ResolvedAmounts;
    toAmounts: ResolvedAmounts;
    incoming: IncomingCardPayment;
  }): Promise<ImportedCardPaymentOutcome>;

  previewImportedCardPayment(input: {
    userId: string;
    incoming: IncomingCardPayment;
  }): Promise<CardPaymentImportDecision>;

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
    estimated: boolean;
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

  /** Reverts every CONFIRMED leg of an operation and marks it REVERSED. */
  reverseTransactionsByTransferGroupId(
    userId: string,
    transferGroupId: string,
  ): Promise<void>;

  createImportedTransaction(
    userId: string,
    data: ImportFinancialTransactionCommand,
  ): Promise<LedgerTransactionRow>;

  pairImportedTransferLegs(
    userId: string,
    debitId: string,
    creditId: string,
  ): Promise<CreateTransferResult | null>;

  addImportedTransferCounterpart(
    userId: string,
    existingId: string,
    counterpart: ImportedTransferCounterpart,
  ): Promise<CreateTransferResult | null>;
}
