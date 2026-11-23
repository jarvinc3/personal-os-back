import type { Prisma } from '@personal-os/database';
import type { BalanceSheetCurrencySlice } from '../domain/balance-sheet-breakdown';
import { decimalToString } from '../../shared/domain/mappers';
import { roundDecimal } from '../../shared/domain/money';
import type {
  BalanceSheetBucket,
  BalanceSheetIssue,
  BalanceSheetSlice,
} from './balance-sheet-types';

export function emptyBucket(): BalanceSheetBucket {
  return {
    accounts: roundDecimal(0),
    cash: roundDecimal(0),
    receivables: roundDecimal(0),
    creditCards: roundDecimal(0),
    loans: roundDecimal(0),
    issues: [],
  };
}

export function serializeSlice(
  bucket: BalanceSheetBucket,
  byCurrency: BalanceSheetCurrencySlice[],
): BalanceSheetSlice {
  // `accounts` already includes cash; `cash` is the informational subset.
  const totalAssets = roundDecimal(bucket.accounts.plus(bucket.receivables));
  const loanDebt = roundDecimal(bucket.loans);
  const incomplete = bucket.issues.length > 0;
  const cardDebt = incomplete ? null : roundDecimal(bucket.creditCards);
  const totalLiabilities =
    incomplete || cardDebt == null
      ? null
      : roundDecimal(cardDebt.plus(loanDebt));
  const netWorth =
    totalLiabilities == null
      ? null
      : roundDecimal(totalAssets.minus(totalLiabilities));

  return {
    status: incomplete ? 'INCOMPLETE' : 'COMPLETE',
    assets: {
      accounts: decimalToString(roundDecimal(bucket.accounts)),
      cash: decimalToString(roundDecimal(bucket.cash)),
      receivables: decimalToString(roundDecimal(bucket.receivables)),
    },
    liabilities: {
      creditCards: cardDebt == null ? null : decimalToString(cardDebt),
      loans: decimalToString(loanDebt),
    },
    totalAssets: decimalToString(totalAssets),
    totalLiabilities:
      totalLiabilities == null ? null : decimalToString(totalLiabilities),
    netWorth: netWorth == null ? null : decimalToString(netWorth),
    byCurrency,
    issues: bucket.issues,
  };
}

/** Global and per-institution totals built while the lines are produced. */
export class BalanceSheetBuckets {
  private readonly globalTotals: BalanceSheetBucket = emptyBucket();
  private readonly institutionTotals = new Map<string, BalanceSheetBucket>();

  constructor(institutionIds: readonly string[]) {
    for (const institutionId of institutionIds) {
      this.institutionTotals.set(institutionId, emptyBucket());
    }
  }

  addIssue(issue: BalanceSheetIssue, institutionId: string | null): void {
    this.globalTotals.issues.push(issue);
    const bucket = this.institutionBucket(institutionId);
    if (bucket) {
      bucket.issues.push(issue);
    }
  }

  addAccount(input: {
    institutionId: string | null;
    amount: Prisma.Decimal;
    isCash: boolean;
  }): void {
    this.globalTotals.accounts = this.globalTotals.accounts.plus(input.amount);
    if (input.isCash) {
      this.globalTotals.cash = this.globalTotals.cash.plus(input.amount);
    }
    const bucket = this.institutionBucket(input.institutionId);
    if (bucket) {
      bucket.accounts = bucket.accounts.plus(input.amount);
      if (input.isCash) {
        bucket.cash = bucket.cash.plus(input.amount);
      }
    }
  }

  addCreditCards(input: {
    institutionId: string | null;
    amount: Prisma.Decimal;
  }): void {
    this.globalTotals.creditCards = this.globalTotals.creditCards.plus(
      input.amount,
    );
    const bucket = this.institutionBucket(input.institutionId);
    if (bucket) {
      bucket.creditCards = bucket.creditCards.plus(input.amount);
    }
  }

  addLoans(input: {
    institutionId: string | null;
    amount: Prisma.Decimal;
  }): void {
    this.globalTotals.loans = this.globalTotals.loans.plus(input.amount);
    const bucket = this.institutionBucket(input.institutionId);
    if (bucket) {
      bucket.loans = bucket.loans.plus(input.amount);
    }
  }

  addReceivables(amount: Prisma.Decimal): void {
    this.globalTotals.receivables = this.globalTotals.receivables.plus(amount);
  }

  globalSlice(byCurrency: BalanceSheetCurrencySlice[]): BalanceSheetSlice {
    return serializeSlice(this.globalTotals, byCurrency);
  }

  institutionSlice(
    institutionId: string,
    byCurrency: BalanceSheetCurrencySlice[],
  ): BalanceSheetSlice {
    return serializeSlice(
      this.institutionTotals.get(institutionId) ?? emptyBucket(),
      byCurrency,
    );
  }

  private institutionBucket(
    institutionId: string | null,
  ): BalanceSheetBucket | undefined {
    if (!institutionId) {
      return undefined;
    }
    return this.institutionTotals.get(institutionId);
  }
}
