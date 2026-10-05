/** Money utilities (domain pure — no Nest/Prisma). */

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

/** Round amount to 2 decimal places for money storage. */
export function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/** Multiply amount × rate and round to money precision. */
export function convertAmount(amount: number, rate: number): number {
  return roundMoney(amount * rate);
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
