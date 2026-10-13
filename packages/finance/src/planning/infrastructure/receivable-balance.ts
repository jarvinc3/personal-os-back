import type { Prisma } from '@personal-os/database';
import {
  resolveReceivablePayment,
  resolveReceivableStatusOverride,
  type ReceivableStatus,
} from '../application/resolve-receivable-payment';

/**
 * Recompute the cached collected amount and status of a receivable inside the
 * caller's transaction. The ledger uses it as well, so collecting an amount and
 * undoing that collection stay one rule.
 */
export async function applyReceivableBalance(
  tx: Prisma.TransactionClient,
  receivableId: string,
  requestedStatus?: ReceivableStatus,
): Promise<void> {
  const receivable = await tx.finReceivable.findUniqueOrThrow({
    where: { id: receivableId },
  });
  const payments = await tx.finReceivablePayment.aggregate({
    where: { receivableId },
    _sum: { appliedAmount: true },
  });
  const collected = resolveReceivablePayment({
    amount: Number(receivable.amount),
    paidAmount: Number(payments._sum.appliedAmount ?? 0),
    status: resolveReceivableStatusOverride({
      storedStatus: receivable.status,
      requestedStatus,
    }),
  });
  await tx.finReceivable.update({
    where: { id: receivableId },
    data: { paidAmount: collected.paidAmount, status: collected.status },
  });
}
