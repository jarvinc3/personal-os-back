import type { FinTransactionType, Prisma } from '../../../prisma/generated/client';

type TxClient = Prisma.TransactionClient;

export function signedAmount(
  type: FinTransactionType,
  amount: number,
): number {
  if (type === 'CREDIT') return amount;
  if (type === 'DEBIT') return -Math.abs(amount);
  // TRANSFER rows should not use this path; legs are DEBIT/CREDIT.
  return 0;
}

/** Only CONFIRMED movements should call this. */
export async function applyAccountBalanceDelta(
  tx: TxClient,
  accountId: string | null | undefined,
  delta: number,
): Promise<void> {
  if (!accountId || delta === 0) return;
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
  if (!cardId || delta === 0) return;

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

export async function applyBalanceForTransaction(
  tx: TxClient,
  params: {
    accountId?: string | null;
    cardId?: string | null;
    currency: string;
    type: FinTransactionType;
    amount: number;
    /** +1 apply, -1 reverse */
    direction?: 1 | -1;
  },
): Promise<void> {
  const direction = params.direction ?? 1;
  const delta = signedAmount(params.type, params.amount) * direction;
  await applyAccountBalanceDelta(tx, params.accountId, delta);
  await applyCardBalanceDelta(tx, params.cardId, params.currency, delta);
}

/**
 * Adjust amountSpent on budgets covering the transaction date for DEBIT+category.
 * direction +1 when confirming/creating CONFIRMED debit; -1 when reversing.
 */
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
  if (params.type !== 'DEBIT' || !params.categoryId) return [];

  const direction = params.direction ?? 1;
  const delta = Math.abs(params.amountBaseCurrency) * direction;
  if (delta === 0) return [];

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
