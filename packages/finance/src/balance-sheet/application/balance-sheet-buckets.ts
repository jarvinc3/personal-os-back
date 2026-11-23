import type { Prisma } from '@personal-os/database';
import {
  BALANCE_SHEET_LINE_KIND,
  type BalanceSheetCurrencySlice,
} from '../domain/balance-sheet-breakdown';
import { decimalToString } from '../../shared/domain/mappers';
import { roundDecimal, toMoney } from '../../shared/domain/money';
import type {
  BalanceSheetBucket,
  BalanceSheetIssue,
  BalanceSheetLineDraft,
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

/**
 * Global and per-institution totals built from the finished lines, in the order
 * they are returned. The accumulator never leaves this class.
 */
export class BalanceSheetTotals {
  private readonly globalTotals: BalanceSheetBucket = emptyBucket();
  private readonly institutionTotals = new Map<string, BalanceSheetBucket>();

  constructor(
    lines: readonly BalanceSheetLineDraft[],
    institutionIds: readonly string[],
  ) {
    for (const institutionId of institutionIds) {
      this.institutionTotals.set(institutionId, emptyBucket());
    }
    for (const line of lines) {
      this.addLine(line);
    }
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

  private addLine(line: BalanceSheetLineDraft): void {
    switch (line.kind) {
      case BALANCE_SHEET_LINE_KIND.ACCOUNT:
      case BALANCE_SHEET_LINE_KIND.CASH:
        this.addAccount(line);
        return;
      case BALANCE_SHEET_LINE_KIND.CREDIT_CARD:
        this.addCreditCard(line);
        return;
      case BALANCE_SHEET_LINE_KIND.LOAN:
        this.addLoan(line);
        return;
      case BALANCE_SHEET_LINE_KIND.RECEIVABLE:
        this.addReceivable(line);
        return;
      default: {
        const unhandled: never = line.kind;
        throw new Error(
          `Unhandled balance sheet line kind: ${String(unhandled)}`,
        );
      }
    }
  }

  private addAccount(line: BalanceSheetLineDraft): void {
    if (line.balanceBase === null) {
      this.addIssue(
        { code: 'MISSING_RATE', currency: line.currency },
        line.institutionId,
      );
      return;
    }
    const amount = this.baseAmount(line);
    const isCash = line.kind === BALANCE_SHEET_LINE_KIND.CASH;
    this.globalTotals.accounts = this.globalTotals.accounts.plus(amount);
    if (isCash) {
      this.globalTotals.cash = this.globalTotals.cash.plus(amount);
    }
    const bucket = this.institutionBucket(line.institutionId);
    if (!bucket) {
      return;
    }
    bucket.accounts = bucket.accounts.plus(amount);
    if (isCash) {
      bucket.cash = bucket.cash.plus(amount);
    }
  }

  private addCreditCard(line: BalanceSheetLineDraft): void {
    if (line.creditLimit === null) {
      this.addIssue(
        {
          code: 'MISSING_CREDIT_LIMIT',
          cardId: line.id,
          currency: line.currency,
        },
        line.institutionId,
      );
      return;
    }
    const amount = this.baseAmount(line);
    this.globalTotals.creditCards = this.globalTotals.creditCards.plus(amount);
    const bucket = this.institutionBucket(line.institutionId);
    if (bucket) {
      bucket.creditCards = bucket.creditCards.plus(amount);
    }
  }

  private addLoan(line: BalanceSheetLineDraft): void {
    const amount = this.baseAmount(line);
    this.globalTotals.loans = this.globalTotals.loans.plus(amount);
    const bucket = this.institutionBucket(line.institutionId);
    if (bucket) {
      bucket.loans = bucket.loans.plus(amount);
    }
  }

  private addReceivable(line: BalanceSheetLineDraft): void {
    if (line.doubtful) {
      return;
    }
    if (line.balanceBase === null) {
      this.addIssue({ code: 'MISSING_RATE', currency: line.currency }, null);
      return;
    }
    this.globalTotals.receivables = this.globalTotals.receivables.plus(
      this.baseAmount(line),
    );
  }

  private addIssue(
    issue: BalanceSheetIssue,
    institutionId: string | null,
  ): void {
    this.globalTotals.issues.push(issue);
    const bucket = this.institutionBucket(institutionId);
    if (bucket) {
      bucket.issues.push(issue);
    }
  }

  private baseAmount(line: BalanceSheetLineDraft): Prisma.Decimal {
    if (line.balanceBase === null) {
      throw new Error(`Balance sheet line ${line.id} has no base amount`);
    }
    return toMoney(line.balanceBase);
  }

  /**
   * An account or card can belong to an institution that is not in the active
   * list. The global slice still counts it, so its absence here is not an error.
   */
  private institutionBucket(
    institutionId: string | null,
  ): BalanceSheetBucket | undefined {
    if (!institutionId) {
      return undefined;
    }
    return this.institutionTotals.get(institutionId);
  }
}
