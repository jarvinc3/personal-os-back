import type { FinTransactionTypeValue } from './transaction-status';

export type LedgerMovementType = FinTransactionTypeValue;

export type LedgerCardType = 'CREDIT' | 'DEBIT';

export function signedAmount(type: LedgerMovementType, amount: number): number {
  if (type === 'CREDIT') {
    return amount;
  }
  if (type === 'DEBIT') {
    return -Math.abs(amount);
  }
  if (type === 'ADJUSTMENT') {
    return amount;
  }
  // TRANSFER rows should not use this path; legs are DEBIT/CREDIT.
  return 0;
}

/** A card payment credits the card's available and debits the account. */
export function cardPaymentDelta(amount: number, isCard: boolean): number {
  return isCard ? Math.abs(amount) : -Math.abs(amount);
}

export type LedgerTarget = {
  accountId: string | null;
  cardId: string | null;
  cardType: LedgerCardType | null;
  derivedAccountId: string | null;
  currencyHint: string | null;
};

export function isXorTargetValid(
  accountId?: string | null,
  cardId?: string | null,
): boolean {
  return Boolean(accountId) !== Boolean(cardId);
}

export const CARD_CURRENCY_UNDECLARED = 'CARD_CURRENCY_UNDECLARED';
export const CARD_CURRENCY_UNDECLARED_MESSAGE =
  'La tarjeta tiene varias monedas y ninguna es la del movimiento. Agrega esa moneda a la tarjeta o usa otra cuenta.';
