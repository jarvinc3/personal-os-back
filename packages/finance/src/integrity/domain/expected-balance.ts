import type {
  LedgerCardType,
  LedgerMovementType,
} from '../../shared/domain/ledger-rules';
import type { FinTransactionTypeValue } from '../../shared/domain/transaction-status';

/**
 * Pure recomputation of the expected balance of an account or credit card from
 * its confirmed movements (invariant I1). Amounts are integer cents so the
 * comparison is exact; the incremental ledger applies the same delta rules.
 */

export type IntegrityMovement = {
  accountId: string | null;
  cardId: string | null;
  type: FinTransactionTypeValue;
  ledgerAmountCents: number;
  ledgerCurrency: string;
};

export type IntegrityCard = {
  id: string;
  type: LedgerCardType;
  accountId: string | null;
};

export type IntegrityAccountRow = {
  id: string;
  currency: string;
  balanceCents: number;
};

export type IntegrityCardBalanceRow = {
  id: string;
  cardId: string;
  currency: string;
  balanceCents: number;
};

export type ExpectedAccount = {
  accountId: string;
  currency: string;
  storedCents: number;
  expectedCents: number;
};

export type ExpectedCardBalance = {
  cardId: string;
  currency: string;
  balanceRowId: string | null;
  storedCents: number;
  expectedCents: number;
};

export type ExpectedBalances = {
  accounts: ExpectedAccount[];
  cards: ExpectedCardBalance[];
};

type AccountTarget = { kind: 'account'; accountId: string };
type CardTarget = { kind: 'card'; cardId: string; currency: string };

type MovementTarget = AccountTarget | CardTarget;

const ADJUSTMENT_TYPE: LedgerMovementType = 'ADJUSTMENT';
const CARD_PAYMENT_TYPE: LedgerMovementType = 'CARD_PAYMENT';
const CREDIT_CARD_TYPE: LedgerCardType = 'CREDIT';

export function movementDeltaCents(movement: IntegrityMovement): number {
  const amount = movement.ledgerAmountCents;
  if (movement.type === CARD_PAYMENT_TYPE) {
    return movement.cardId ? Math.abs(amount) : -Math.abs(amount);
  }
  if (movement.type === 'CREDIT') {
    return amount;
  }
  if (movement.type === 'DEBIT') {
    return -Math.abs(amount);
  }
  if (movement.type === ADJUSTMENT_TYPE) {
    return amount;
  }
  return 0;
}

/**
 * Product each movement moves. Mirrors `applyBalanceForTransaction`: a debit
 * card charge lands on its linked account, while adjustments and card payments
 * always land on the card balance row of the movement currency.
 */
export function movementTarget(
  movement: IntegrityMovement,
  cardById: ReadonlyMap<string, IntegrityCard>,
): MovementTarget | null {
  if (movement.cardId) {
    const card = cardById.get(movement.cardId);
    if (!card) {
      return null;
    }
    if (
      movement.type === ADJUSTMENT_TYPE ||
      movement.type === CARD_PAYMENT_TYPE ||
      card.type === CREDIT_CARD_TYPE
    ) {
      return {
        kind: 'card',
        cardId: card.id,
        currency: movement.ledgerCurrency,
      };
    }
    if (!card.accountId) {
      return null;
    }
    return { kind: 'account', accountId: card.accountId };
  }
  if (!movement.accountId) {
    return null;
  }
  return { kind: 'account', accountId: movement.accountId };
}

function cardBalanceKey(cardId: string, currency: string): string {
  return `${cardId}:${currency}`;
}

export function computeExpectedBalances(input: {
  accounts: readonly IntegrityAccountRow[];
  cards: readonly IntegrityCard[];
  cardBalances: readonly IntegrityCardBalanceRow[];
  movements: readonly IntegrityMovement[];
}): ExpectedBalances {
  const cardById = new Map(input.cards.map((card) => [card.id, card]));
  const accountTotals = new Map<string, number>();
  const cardTotals = new Map<string, number>();

  for (const movement of input.movements) {
    const target = movementTarget(movement, cardById);
    if (!target) {
      continue;
    }
    const delta = movementDeltaCents(movement);
    if (target.kind === 'account') {
      accountTotals.set(
        target.accountId,
        (accountTotals.get(target.accountId) ?? 0) + delta,
      );
      continue;
    }
    const key = cardBalanceKey(target.cardId, target.currency);
    cardTotals.set(key, (cardTotals.get(key) ?? 0) + delta);
  }

  const accounts: ExpectedAccount[] = input.accounts.map((account) => ({
    accountId: account.id,
    currency: account.currency,
    storedCents: account.balanceCents,
    expectedCents: accountTotals.get(account.id) ?? 0,
  }));

  const cardBalanceByKey = new Map(
    input.cardBalances.map((row) => [
      cardBalanceKey(row.cardId, row.currency),
      row,
    ]),
  );
  const cards: ExpectedCardBalance[] = input.cardBalances.map((row) => ({
    cardId: row.cardId,
    currency: row.currency,
    balanceRowId: row.id,
    storedCents: row.balanceCents,
    expectedCents:
      cardTotals.get(cardBalanceKey(row.cardId, row.currency)) ?? 0,
  }));

  for (const [key, expectedCents] of cardTotals) {
    if (cardBalanceByKey.has(key) || expectedCents === 0) {
      continue;
    }
    const separator = key.indexOf(':');
    cards.push({
      cardId: key.slice(0, separator),
      currency: key.slice(separator + 1),
      balanceRowId: null,
      storedCents: 0,
      expectedCents,
    });
  }

  return { accounts, cards };
}

export function hasDrift(product: {
  storedCents: number;
  expectedCents: number;
}): boolean {
  return product.storedCents !== product.expectedCents;
}
