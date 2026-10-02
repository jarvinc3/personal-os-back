import type {
  FinCardType,
  FinTransactionType,
  Prisma,
} from '@personal-os/database';
import type { LedgerTarget } from '../../shared/domain/ledger-rules';
import { signedAmount } from '../../shared/domain/ledger-rules';

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
  const delta = signedAmount(params.type, params.amount) * direction;

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
      categoryId: params.categoryId,
      periodStart: { lte: dateOnly },
      periodEnd: { gte: dateOnly },
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
