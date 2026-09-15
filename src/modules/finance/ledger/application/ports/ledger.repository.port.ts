import type { BudgetSpendSnapshot } from '../../../shared/domain/budget-snapshot';
import type { ResolvedAmounts } from '../../../shared/domain/money';
import type {
    CreateTransactionCommand,
    CreateTransferCommand,
    ImportEmailTransactionCommand,
    ListTransactionsQuery,
    TransactionUpdateFields,
} from '../commands/ledger.commands';

/** Minimal account row returned by ledger reads. */
export type LedgerAccountRow = {
  id: string;
  currency: string;
  name?: string;
} | null;

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
  transferGroupId: string | null;
  linkedTransactionId: string | null;
  emailMessageId?: string | null;
  aiMetadata?: unknown;
  transactionDate: Date;
  createdAt: Date;
  account?: { id: string; name: string } | null;
  card?: { id: string; name: string } | null;
  transferCounterpart?: LedgerTransactionRow | null;
};

export type CreateTransactionResult = {
  transaction: LedgerTransactionRow;
  budgetSnapshots: BudgetSpendSnapshot[];
};

export type CreateTransferResult = {
  debit: LedgerTransactionRow;
  credit: LedgerTransactionRow;
  transferGroupId: string;
};

/**
 * Persistence port for ledger reads and multi-step writes
 * (balance + budget spent + outbox inside the same transaction).
 */
export interface LedgerRepositoryPort {
  findTransactions(
    userId: string,
    query: ListTransactionsQuery,
  ): Promise<[LedgerTransactionRow[], number]>;

  findTransactionById(
    id: string,
    userId: string,
  ): Promise<LedgerTransactionRow | null>;

  findAccountById(
    id: string,
    userId: string,
  ): Promise<{ id: string; currency: string } | null>;

  findTransactionByEmailMessageId(
    gmailMessageId: string,
    userId?: string,
  ): Promise<LedgerTransactionRow | null>;

  findTransactionsByTransferGroupId(
    transferGroupId: string,
    userId: string,
  ): Promise<LedgerTransactionRow[]>;

  findCandidatesForReverse(
    userId: string,
    params: {
      amount: number;
      currency: string;
      merchant: string | null;
      aroundDate: Date;
    },
  ): Promise<LedgerTransactionRow[]>;

  createTransaction(
    userId: string,
    command: CreateTransactionCommand,
    amounts: ResolvedAmounts,
    source?: 'MANUAL' | 'EMAIL' | 'AI',
    extras?: {
      emailMessageId?: string;
      aiMetadata?: unknown;
      linkedTransactionId?: string;
    },
  ): Promise<CreateTransactionResult | null>;

  createTransfer(
    userId: string,
    command: CreateTransferCommand,
    fromAmounts: ResolvedAmounts,
    toAmounts: ResolvedAmounts,
  ): Promise<CreateTransferResult | null>;

  updateTransaction(
    userId: string,
    id: string,
    data: TransactionUpdateFields,
  ): Promise<CreateTransactionResult | null>;

  deleteTransaction(
    userId: string,
    id: string,
  ): Promise<{ count: number }>;

  deleteTransactionsByTransferGroupId(
    userId: string,
    transferGroupId: string,
  ): Promise<{ count: number }>;

  confirmTransaction(
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
}
