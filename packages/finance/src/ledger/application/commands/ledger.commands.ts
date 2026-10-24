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

export const TRANSFER_RAILS = ['SAME_BANK', 'ACH', 'LBTR', 'OTHER'] as const;

export type TransferRail = (typeof TRANSFER_RAILS)[number];

export type TransferFeeCommand = {
  amount: number;
  categoryId?: string;
};

export type FinTxType = 'DEBIT' | 'CREDIT' | 'TRANSFER';

export type CreateTransactionCommand = {
  accountId?: string;
  cardId?: string;
  type: 'DEBIT' | 'CREDIT';
  amount: number;
  currency?: string;
  transactionDate: string;
  merchant?: string;
  /** Canonical merchant resolved from `merchant` by the use case. */
  merchantId?: string;
  description?: string;
  notes?: string;
  categoryId?: string;
  status?: FinTxStatus;
  /**
   * `false` when the movement is a side effect of an action the user already
   * confirmed on screen (a goal contribution, a loan prepayment), so it does not
   * announce itself again.
   */
  announce?: boolean;
};

export type UpdateTransactionCommand = {
  type?: 'DEBIT' | 'CREDIT';
  accountId?: string | null;
  cardId?: string | null;
  amount?: number;
  currency?: string;
  merchant?: string | null;
  merchantId?: string | null;
  description?: string | null;
  notes?: string | null;
  transactionDate?: string;
  categoryId?: string | null;
  status?: FinTxStatus;
};

export type CreateTransferCommand = {
  fromAccountId?: string;
  /** Internal callers only (email matching); the HTTP API never accepts a card origin. */
  fromCardId?: string;
  toAccountId?: string;
  amount: number;
  currency?: string;
  transactionDate: string;
  description?: string;
  notes?: string;
  status?: TransferStatus;
  rail?: TransferRail;
  fee?: TransferFeeCommand | null;
  /** Creates the destination leg as PENDING while the money is in transit. */
  destinationPending?: boolean;
  /** Rate from the source currency to the destination currency. */
  exchangeRate?: number;
  /** Amount that actually enters the destination account, in its currency. */
  receivedAmount?: number;
  source?: 'MANUAL' | 'EMAIL' | 'AI';
  /** Same meaning as in a single movement: `false` skips the notification. */
  announce?: boolean;
  fromEmailMessageId?: string;
  toEmailMessageId?: string;
  aiMetadata?: unknown;
};

export type ListTransactionsQuery = {
  cursor?: string;
  limit?: number;
  transferGroupId?: string;
  accountId?: string;
  cardId?: string;
  categoryId?: string;
  categoryIds?: string[];
  type?: FinTransactionTypeValue;
  status?: FinTxStatus;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  merchantId?: string;
  includeAdjustments?: boolean;
  groupOperations?: boolean;
  possibleDuplicates?: boolean;
};

export type CreateCardPaymentCommand = {
  fromAccountId: string;
  cardId: string;
  amount: number;
  currency?: string;
  transactionDate: string;
  description?: string;
  notes?: string;
  status?: TransferStatus;
  statementId?: string;
  source?: 'MANUAL' | 'AI';
};

export type ImportEmailTransactionCommand = {
  accountId?: string;
  cardId?: string;
  importReference: string;
  externalReference?: string | null;
  possibleDuplicateOfId?: string | null;
  amount: number;
  currency: string;
  merchant: string | null;
  merchantId?: string | null;
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
  merchantId?: string | null;
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
  isEstimated?: boolean;
};
