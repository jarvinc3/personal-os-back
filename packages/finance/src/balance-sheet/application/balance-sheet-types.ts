import type { Prisma } from '@personal-os/database';
import type {
  BalanceSheetBreakdown,
  BalanceSheetCurrencySlice,
  BalanceSheetLine,
} from '../domain/balance-sheet-breakdown';

export type BalanceSheetStatus = 'COMPLETE' | 'INCOMPLETE';

export type BalanceSheetIssue =
  | {
      code: 'MISSING_CREDIT_LIMIT';
      cardId: string;
      currency: string;
    }
  | { code: 'MISSING_RATE'; currency: string };

export type CashAccountLine = {
  id: string;
  name: string;
  balance: string;
};

export type CashCurrencyBreakdown = {
  currency: string;
  total: string;
  totalBase: string | null;
  accounts: CashAccountLine[];
};

/** Cash converted to the user's base currency, with a per-currency breakdown. */
export type FinanceCashSummary = {
  totalBase: string | null;
  baseCurrency: string;
  rateDate: string;
  status: BalanceSheetStatus;
  byCurrency: CashCurrencyBreakdown[];
};

export type BalanceSheetSlice = {
  status: BalanceSheetStatus;
  assets: { accounts: string; cash: string; receivables: string };
  liabilities: {
    creditCards: string | null;
    loans: string;
  };
  totalAssets: string;
  totalLiabilities: string | null;
  netWorth: string | null;
  /** Native totals per currency; no conversion and no receivables without institution. */
  byCurrency: BalanceSheetCurrencySlice[];
  issues: BalanceSheetIssue[];
};

export type FinanceBalanceSheet = {
  asOf: string;
  rateDate: string;
  baseCurrency: string;
  global: BalanceSheetSlice;
  institutions: Array<BalanceSheetSlice & { institutionId: string }>;
  cash: FinanceCashSummary;
  breakdown: BalanceSheetBreakdown;
};

export type BalanceSheetBucket = {
  accounts: Prisma.Decimal;
  cash: Prisma.Decimal;
  receivables: Prisma.Decimal;
  creditCards: Prisma.Decimal;
  loans: Prisma.Decimal;
  issues: BalanceSheetIssue[];
};

export type ReceivableRow = {
  id: string;
  debtorName: string;
  description: string | null;
  amount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  writtenOffAmount: Prisma.Decimal;
  currency: string;
  dueDate: Date | null;
};

export type BalanceSheetLineDraft = Omit<BalanceSheetLine, 'entity'>;
