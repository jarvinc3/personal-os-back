import type { Prisma } from '@personal-os/database';
import { shiftLoanDueDate } from '../../planning/domain/loan-installment-schedule';
import { applyReceivableBalance } from '../../planning/infrastructure/receivable-balance';
import { applySavingsGoalBalance } from '../../planning/infrastructure/savings-goal-balance';

/**
 * A collected amount, a paid instalment and a savings contribution point at the
 * movement they created. Removing or reversing that movement takes its planning
 * effect with it, in the same transaction, so the two sides never disagree.
 */
export async function revertPlanningLinks(
  tx: Prisma.TransactionClient,
  transactionIds: readonly string[],
): Promise<void> {
  if (transactionIds.length === 0) {
    return;
  }
  await revertReceivablePayments(tx, transactionIds);
  await revertLoanInstallments(tx, transactionIds);
  await revertSavingsGoalContributions(tx, transactionIds);
}

async function revertReceivablePayments(
  tx: Prisma.TransactionClient,
  transactionIds: readonly string[],
): Promise<void> {
  const payments = await tx.finReceivablePayment.findMany({
    where: { transactionId: { in: [...transactionIds] } },
    select: { id: true, receivableId: true },
  });
  if (payments.length === 0) {
    return;
  }
  await tx.finReceivablePayment.deleteMany({
    where: { id: { in: payments.map((payment) => payment.id) } },
  });
  const receivableIds = [
    ...new Set(payments.map((payment) => payment.receivableId)),
  ];
  for (const receivableId of receivableIds) {
    await applyReceivableBalance(tx, receivableId);
  }
}

async function revertLoanInstallments(
  tx: Prisma.TransactionClient,
  transactionIds: readonly string[],
): Promise<void> {
  const installments = await tx.finLoanInstallment.findMany({
    where: { transactionId: { in: [...transactionIds] } },
    include: { loan: true },
  });
  if (installments.length === 0) {
    return;
  }
  await tx.finLoanInstallment.updateMany({
    where: { id: { in: installments.map((installment) => installment.id) } },
    data: { paidAt: null, transactionId: null },
  });
  for (const installment of installments) {
    const loan = installment.loan;
    await tx.finLoan.update({
      where: { id: loan.id },
      data: {
        paidInstallments: Math.max(0, loan.paidInstallments - 1),
        currentBalance:
          Number(loan.currentBalance) + Number(loan.installmentAmount),
        nextDueDate: shiftLoanDueDate(
          loan.nextDueDate,
          loan.installmentFreq,
          -1,
        ),
      },
    });
  }
}

async function revertSavingsGoalContributions(
  tx: Prisma.TransactionClient,
  transactionIds: readonly string[],
): Promise<void> {
  const contributions = await tx.finSavingsGoalContribution.findMany({
    where: { transactionId: { in: [...transactionIds] } },
    select: { id: true, goalId: true },
  });
  if (contributions.length === 0) {
    return;
  }
  await tx.finSavingsGoalContribution.deleteMany({
    where: { id: { in: contributions.map((item) => item.id) } },
  });
  const goalIds = [...new Set(contributions.map((item) => item.goalId))];
  const now = new Date();
  for (const goalId of goalIds) {
    await applySavingsGoalBalance(tx, goalId, now);
  }
}
