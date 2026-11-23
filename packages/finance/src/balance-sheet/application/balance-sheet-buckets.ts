import type { Prisma } from '@personal-os/database';
import { decimalToString } from '../../shared/domain/mappers';
import { roundDecimal } from '../../shared/domain/money';
import type { BalanceSheetCurrencySlice } from '../domain/balance-sheet-breakdown';
import type {
  BalanceSheetIssue,
  BalanceSheetSlice,
} from './balance-sheet-types';

export type Bucket = {
  accounts: Prisma.Decimal;
  cash: Prisma.Decimal;
  receivables: Prisma.Decimal;
  creditCards: Prisma.Decimal;
  loans: Prisma.Decimal;
  issues: BalanceSheetIssue[];
};

export type BalanceSheetAccumulation = {
  global: Bucket;
  byInstitution: Map<string, Bucket>;
};

export function emptyBucket(): Bucket {
  return {
    accounts: roundDecimal(0),
    cash: roundDecimal(0),
    receivables: roundDecimal(0),
    creditCards: roundDecimal(0),
    loans: roundDecimal(0),
    issues: [],
  };
}

/** Acumulados global y por institución mientras se arman las líneas. */
export function emptyAccumulation(
  institutionIds: readonly string[],
): BalanceSheetAccumulation {
  const byInstitution = new Map<string, Bucket>();
  for (const institutionId of institutionIds) {
    byInstitution.set(institutionId, emptyBucket());
  }
  return { global: emptyBucket(), byInstitution };
}

export function serializeSlice(
  bucket: Bucket,
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
