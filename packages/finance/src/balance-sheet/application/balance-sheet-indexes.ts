import type { Prisma } from '@personal-os/database';
import { BALANCE_SHEET_RECONCILIATION } from '../domain/balance-sheet-breakdown';
import { normalizeCurrencyCode } from '../../shared/domain/money';
import { decimalToString } from '../../shared/domain/mappers';

type DriftRow = {
  accountId: string | null;
  cardId: string | null;
  currency: string;
  difference: Prisma.Decimal;
};

type ReconciliationRow = {
  accountId: string | null;
  cardId: string | null;
  currency: string;
};

export type BalanceSheetIndexes = {
  reconciledKeys: Set<string>;
  driftByAccount: Map<string, { difference: Prisma.Decimal }>;
  driftByCard: Map<string, { difference: Prisma.Decimal }>;
};

export function accountKey(accountId: string, currency: string): string {
  return `account:${accountId}:${normalizeCurrencyCode(currency)}`;
}

export function cardKey(cardId: string, currency: string): string {
  return `card:${cardId}:${normalizeCurrencyCode(currency)}`;
}

export function driftValue(drift: { difference: Prisma.Decimal } | undefined): {
  hasDrift: boolean;
  driftDifference: string | null;
} {
  if (!drift) {
    return { hasDrift: false, driftDifference: null };
  }
  return {
    hasDrift: true,
    driftDifference: decimalToString(drift.difference),
  };
}

export function reconciliationState(
  reconciledKeys: ReadonlySet<string>,
  key: string,
): (typeof BALANCE_SHEET_RECONCILIATION)[keyof typeof BALANCE_SHEET_RECONCILIATION] {
  return reconciledKeys.has(key)
    ? BALANCE_SHEET_RECONCILIATION.RECONCILED
    : BALANCE_SHEET_RECONCILIATION.PENDING;
}

export function buildBalanceSheetIndexes(input: {
  reconciliations: readonly ReconciliationRow[];
  drifts: readonly DriftRow[];
}): BalanceSheetIndexes {
  const reconciledKeys = new Set<string>();
  for (const reconciliation of input.reconciliations) {
    if (reconciliation.accountId) {
      reconciledKeys.add(
        accountKey(reconciliation.accountId, reconciliation.currency),
      );
    }
    if (reconciliation.cardId) {
      reconciledKeys.add(
        cardKey(reconciliation.cardId, reconciliation.currency),
      );
    }
  }

  const driftByAccount = new Map<string, { difference: Prisma.Decimal }>();
  const driftByCard = new Map<string, { difference: Prisma.Decimal }>();
  for (const drift of input.drifts) {
    if (drift.accountId) {
      driftByAccount.set(accountKey(drift.accountId, drift.currency), {
        difference: drift.difference,
      });
    }
    if (drift.cardId) {
      driftByCard.set(cardKey(drift.cardId, drift.currency), {
        difference: drift.difference,
      });
    }
  }

  return { reconciledKeys, driftByAccount, driftByCard };
}
