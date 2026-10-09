import type { ResolvedAmounts } from '../../../shared/domain/money';
import type { FinTransactionTypeValue } from '../../../shared/domain/transaction-status';

export type FinTxStatus =
  'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'DECLINED' | 'REVERSED';

export const TRANSFER_STATUS = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
} as const;

export type TransferStatus =
  (typeof TRANSFER_STATUS)[keyof typeof TRANSFER_STATUS];

export type FinTxType = 'DEBIT' | 'CREDIT' | 'TRANSFER';

export type CreateTransactionCommand = {
  accountId?: string;
  cardId?: string;
  type: 'DEBIT' | 'CREDIT';
  amount: number;
  currency?: string;
  transactionDate: string;
  merchant?: string;
  description?: string;
  notes?: string;
  categoryId?: string;
  status?: FinTxStatus;
};

export type UpdateTransactionCommand = {
  type?: 'DEBIT' | 'CREDIT';
  accountId?: string | null;
  cardId?: string | null;
  amount?: number;
  currency?: string;
  merchant?: string | null;
  description?: string | null;
  notes?: string | null;
  transactionDate?: string;
  categoryId?: string | null;
  status?: FinTxStatus;
};

export type CreateTransferCommand = {
  fromAccountId?: string;
  fromCardId?: string;
  toAccountId?: string;
  toCardId?: string;
  amount: number;
  currency?: string;
  transactionDate: string;
  description?: string;
  notes?: string;
  status?: TransferStatus;
  source?: 'MANUAL' | 'EMAIL' | 'AI';
  fromEmailMessageId?: string;
  toEmailMessageId?: string;
  aiMetadata?: unknown;
};

export type ListTransactionsQuery = {
  page?: number;
  limit?: number;
  transferGroupId?: string;
  accountId?: string;
  cardId?: string;
  categoryId?: string;
  type?: FinTransactionTypeValue;
  status?: FinTxStatus;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
};

export type ImportEmailTransactionCommand = {
  accountId?: string;
  cardId?: string;
  emailMessageId: string;
  externalReference?: string | null;
  amount: number;
  currency: string;
  merchant: string | null;
  description: string;
  notes?: string | null;
  transactionDate: Date;
  categoryId?: string | null;
  type?: 'DEBIT' | 'CREDIT';
  transferGroupId?: string | null;
  status: FinTxStatus;
  amounts: ResolvedAmounts;
  aiMetadata?: unknown;
};

/** Scalar fields applied to Prisma update after FX resolution. */
export type TransactionUpdateFields = {
  type?: 'DEBIT' | 'CREDIT' | 'TRANSFER';
  accountId?: string | null;
  cardId?: string | null;
  merchant?: string | null;
  description?: string | null;
  notes?: string | null;
  transactionDate?: Date;
  categoryId?: string | null;
  status?: FinTxStatus;
  amount?: number;
  currency?: string;
  ledgerAmount?: number;
  ledgerCurrency?: string;
  amountBaseCurrency?: number;
  exchangeRate?: number;
};
