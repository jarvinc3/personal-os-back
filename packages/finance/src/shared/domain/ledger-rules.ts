import type { FinCardType, FinTransactionType } from '../../../../prisma/generated/client';

export function signedAmount(
  type: FinTransactionType,
  amount: number,
): number {
  if (type === 'CREDIT') return amount;
  if (type === 'DEBIT') return -Math.abs(amount);
  // TRANSFER rows should not use this path; legs are DEBIT/CREDIT.
  return 0;
}

export type LedgerTarget = {
  accountId: string | null;
  cardId: string | null;
  cardType: FinCardType | null;
  derivedAccountId: string | null;
  currencyHint: string | null;
};

export function isXorTargetValid(
  accountId?: string | null,
  cardId?: string | null,
): boolean {
  return Boolean(accountId) !== Boolean(cardId);
}
