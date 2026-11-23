import { roundMoney } from '../../shared/domain/money';

/** Amount as the two-decimal string the integrity API and its events expose. */
export function moneyLabel(value: { toString(): string } | number): string {
  return roundMoney(Number(value)).toFixed(2);
}

/** Exact cents of a stored decimal, so two balances compare without float noise. */
export function toCents(value: { toString(): string }): number {
  return Math.round(Number(value) * 100);
}
