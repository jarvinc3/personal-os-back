import type {
  FinCardType,
  FinTransactionType,
  Prisma,
} from '@personal-os/database';
import type { StoredMovement } from '../../shared/domain/deletion-snapshot';
import type { LedgerTarget } from '../../shared/domain/ledger-rules';
import {
  cardPaymentDelta,
  signedAmount,
} from '../../shared/domain/ledger-rules';
import {
  statusAffectsLedger,
  type FinTransactionStatusValue,
} from '../../shared/domain/transaction-status';

export { signedAmount } from '../../shared/domain/ledger-rules';
export type { LedgerTarget } from '../../shared/domain/ledger-rules';

type TxClient = Prisma.TransactionClient;

/** Only CONFIRMED movements should call this. */
export async function applyAccountBalanceDelta(
  tx: TxClient,
  accountId: string | null | undefined,
  delta: number,
): Promise<void> {
  if (!accountId || delta === 0) {
    return;
  }
  await tx.finAccount.update({
    where: { id: accountId },
    data: { balance: { increment: delta } },
  });
}

export async function applyCardBalanceDelta(
  tx: TxClient,
  cardId: string | null | undefined,
  currency: string,
  delta: number,
): Promise<void> {
  if (!cardId || delta === 0) {
    return;
  }

  const balanceRow = await tx.finCardBalance.findFirst({
    where: { cardId, currency },
  });

  if (balanceRow) {
    await tx.finCardBalance.update({
      where: { id: balanceRow.id },
      data: { balance: { increment: delta } },
    });
    return;
  }

  await tx.finCardBalance.create({
    data: { cardId, currency, balance: delta },
  });
}

/**
 * Apply balance side-effects for a transaction using ledger amount/currency.
 */
export async function applyBalanceForTransaction(
  tx: TxClient,
  params: {
    accountId?: string | null;
    cardId?: string | null;
    cardType?: FinCardType | null;
    derivedAccountId?: string | null;
    /** Ledger currency for card balance rows */
    currency: string;
    type: FinTransactionType;
    /** Ledger amount (not original) */
    amount: number;
    direction?: 1 | -1;
  },
): Promise<void> {
  const direction = params.direction ?? 1;
  const delta =
    params.type === 'CARD_PAYMENT'
      ? cardPaymentDelta(params.amount, Boolean(params.cardId)) * direction
      : signedAmount(params.type, params.amount) * direction;

  if (params.type === 'CARD_PAYMENT') {
    if (params.cardId) {
      await applyCardBalanceDelta(tx, params.cardId, params.currency, delta);
      return;
    }
    await applyAccountBalanceDelta(tx, params.accountId, delta);
    return;
  }

  if (params.type === 'ADJUSTMENT') {
    if (params.cardId) {
      await applyCardBalanceDelta(tx, params.cardId, params.currency, delta);
      return;
    }
    await applyAccountBalanceDelta(tx, params.accountId, delta);
    return;
  }

  if (params.cardId) {
    if (params.cardType === 'CREDIT') {
      await applyCardBalanceDelta(tx, params.cardId, params.currency, delta);
      return;
    }
    const accountId = params.derivedAccountId ?? null;
    await applyAccountBalanceDelta(tx, accountId, delta);
    return;
  }

  await applyAccountBalanceDelta(tx, params.accountId, delta);
}

/**
 * Applies again the balance and budget effect of movements the journal holds.
 * The rows come back as JSON, so dates and decimals are read from strings.
 */
export async function restoreLedgerRows(
  tx: TxClient,
  userId: string,
  movements: readonly StoredMovement[],
): Promise<void> {
  for (const movement of movements) {
    if (!statusAffectsLedger(movement.status as FinTransactionStatusValue)) {
      continue;
    }
    const card = movement.cardId
      ? await tx.finCard.findFirst({ where: { id: movement.cardId, userId } })
      : null;
    await applyBalanceForTransaction(tx, {
      accountId: movement.accountId,
      cardId: movement.cardId,
      cardType: card?.type ?? null,
      derivedAccountId: card?.type === 'DEBIT' ? card.accountId : null,
      currency: movement.ledgerCurrency ?? movement.currency,
      type: movement.type as FinTransactionType,
      amount: Number(movement.ledgerAmount ?? movement.amount),
      direction: 1,
    });
    await adjustBudgetSpent(tx, {
      userId,
      categoryId: movement.categoryId,
      type: movement.type as FinTransactionType,
      amountBaseCurrency: Number(
        movement.amountBaseCurrency ?? movement.amount,
      ),
      transactionDate: new Date(movement.transactionDate),
      direction: 1,
    });
  }
}

export async function adjustBudgetSpent(
  tx: TxClient,
  params: {
    userId: string;
    categoryId: string | null | undefined;
    type: FinTransactionType;
    amountBaseCurrency: number;
    transactionDate: Date;
    direction?: 1 | -1;
  },
): Promise<
  Array<{
    budgetId: string;
    amountSpent: number;
    amountLimit: number;
    alertThresholdPct: number;
  }>
> {
  if (params.type !== 'DEBIT' || !params.categoryId) {
    return [];
  }

  const direction = params.direction ?? 1;
  const delta = Math.abs(params.amountBaseCurrency) * direction;
  if (delta === 0) {
    return [];
  }

  const dateOnly = new Date(params.transactionDate);
  dateOnly.setUTCHours(0, 0, 0, 0);

  const budgets = await tx.finBudget.findMany({
    where: {
      userId: params.userId,
      periodStart: { lte: dateOnly },
      periodEnd: { gte: dateOnly },
      OR: [
        { categoryId: params.categoryId },
        { categories: { some: { categoryId: params.categoryId } } },
        {
          includeChildren: true,
          categories: {
            some: { category: { parentId: params.categoryId } },
          },
        },
      ],
    },
  });

  const crossed: Array<{
    budgetId: string;
    amountSpent: number;
    amountLimit: number;
    alertThresholdPct: number;
  }> = [];

  for (const budget of budgets) {
    const updated = await tx.finBudget.update({
      where: { id: budget.id },
      data: { amountSpent: { increment: delta } },
    });
    crossed.push({
      budgetId: updated.id,
      amountSpent: Number(updated.amountSpent),
      amountLimit: Number(updated.amountLimit),
      alertThresholdPct: Number(updated.alertThresholdPct),
    });
  }

  return crossed;
}

export async function resolveLedgerTarget(
  tx: TxClient,
  userId: string,
  accountId?: string | null,
  cardId?: string | null,
): Promise<LedgerTarget | null> {
  const hasAccount = Boolean(accountId);
  const hasCard = Boolean(cardId);
  if (hasAccount === hasCard) {
    return null;
  }

  if (hasAccount && accountId) {
    const account = await tx.finAccount.findFirst({
      where: { id: accountId, userId },
    });
    if (!account) {
      return null;
    }
    return {
      accountId: account.id,
      cardId: null,
      cardType: null,
      derivedAccountId: null,
      currencyHint: account.currency,
    };
  }

  if (hasCard && cardId) {
    const card = await tx.finCard.findFirst({
      where: { id: cardId, userId },
    });
    if (!card) {
      return null;
    }
    if (card.type === 'DEBIT' && !card.accountId) {
      return null;
    }
    if (card.type === 'CREDIT' && card.accountId) {
      return null;
    }

    return {
      accountId: null,
      cardId: card.id,
      cardType: card.type,
      derivedAccountId: card.type === 'DEBIT' ? card.accountId : null,
      currencyHint: null,
    };
  }

  return null;
}
