import type { BudgetSpendSnapshot } from '../../../shared/domain/budget-snapshot';
import type { LedgerCardType } from '../../../shared/domain/ledger-rules';
import type { ResolvedAmounts } from '../../../shared/domain/money';
import type { PossibleManualCardPaymentDuplicate } from '../find-manual-card-payment-duplicate';
import type { FinTxStatus } from '../commands/ledger.commands';

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

/** Resultado de un pago manual: escribe, o pide confirmación del candidato. */
export type ManualCardPaymentOutcome =
  | { kind: 'created'; payment: CreateTransferResult }
  | PossibleManualCardPaymentDuplicate
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
