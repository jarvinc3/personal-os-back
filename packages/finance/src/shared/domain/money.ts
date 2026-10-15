/** Money utilities. Amounts are exact decimals; numbers only for ratios. */

import { Prisma } from '@personal-os/database';

/** Local spellings that banks print instead of the ISO 4217 code. */
const CURRENCY_CODE_ALIASES: Record<string, string> = {
  RDS: 'DOP',
  RD$: 'DOP',
};

export function normalizeCurrencyCode(input: string): string {
  const normalized = input.trim().toUpperCase();
  return CURRENCY_CODE_ALIASES[normalized] ?? normalized;
}

export function isIsoCurrency(code: string): boolean {
  return /^[A-Z]{3}$/.test(normalizeCurrencyCode(code));
}

/** Money keeps two decimals in storage and display (ADR-002). */
export const MONEY_DECIMALS = 2;

/**
 * Values accepted as money: the Decimal from a query, its string form, or a
 * number. A missing amount — null from an aggregate, undefined from an
 * optional field — means zero, never a second business state.
 */
export type MoneyLike = Prisma.Decimal | string | number | null | undefined;

/** The decimal type amounts carry through the back. */
export type Decimal = Prisma.Decimal;

export function toMoney(value: MoneyLike): Prisma.Decimal {
  if (value === null || value === undefined) {
    return new Prisma.Decimal(0);
  }
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

/**
 * Rounding for money is bankers' rounding (ROUND_HALF_EVEN): a half cent lands
 * on the even cent, so rounding twice in a row never drifts.
 */
export function roundDecimal(value: MoneyLike): Prisma.Decimal {
  const amount = toMoney(value);
  return new Prisma.Decimal(
    amount.toFixed(MONEY_DECIMALS, Prisma.Decimal.ROUND_HALF_EVEN),
  );
}

/** Exact money sum. Never adds through JavaScript numbers. */
export function sumMoney(values: readonly MoneyLike[]): Prisma.Decimal {
  let total = new Prisma.Decimal(0);
  for (const value of values) {
    total = total.plus(toMoney(value));
  }
  return total;
}

/** Amount × rate, rounded to money precision. */
export function convertDecimal(
  amount: MoneyLike,
  rate: MoneyLike,
): Prisma.Decimal {
  return roundDecimal(toMoney(amount).times(toMoney(rate)));
}

/**
 * `part` as a percentage of `whole`, as a plain number. Only ratios and chart
 * scales need JavaScript numbers; amounts stay decimal until this boundary.
 */
export function ratioPercent(part: MoneyLike, whole: MoneyLike): number {
  const total = toMoney(whole);
  if (total.isZero()) {
    return 0;
  }
  return toMoney(part).div(total).times(100).toNumber();
}

/** Plain number for a non-money scalar stored as Decimal (a percentage, a count). */
export function scalarNumber(value: MoneyLike): number {
  return toMoney(value).toNumber();
}

/** Round amount to 2 decimal places for a number-only write path. */
export function roundMoney(amount: number): number {
  return roundDecimal(amount).toNumber();
}

/** Multiply amount × rate and round to money precision, for a number-only write path. */
export function convertAmount(amount: number, rate: number): number {
  return convertDecimal(amount, rate).toNumber();
}

export type ResolvedAmounts = {
  /** Original amount in `currency`. */
  amount: number;
  currency: string;
  /** Amount applied to ledger target. */
  ledgerAmount: number;
  ledgerCurrency: string;
  /** Amount in BASE_CURRENCY for analytics. */
  amountBaseCurrency: number;
  /** Rate original → ledger (1 when same). */
  exchangeRate: number;
};
