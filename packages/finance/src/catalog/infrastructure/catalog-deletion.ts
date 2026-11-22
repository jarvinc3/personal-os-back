import { Prisma } from '@personal-os/database';
import type { LedgerTransactionRow } from '../../ledger/application/ports/ledger.repository.port';
import { restoreLedgerRows } from '../../ledger/infrastructure/balance.helpers';
import {
  DELETION_MODEL,
  reversedMovements,
  toDeletionValues,
  type ClearedAccountLink,
  type DeletionRow,
  type DeletionSnapshot,
} from '../../shared/domain/deletion-snapshot';

export type LedgerPurge = {
  userId: string;
  id: string;
  movements: readonly LedgerTransactionRow[];
};

type CardSnapshotSource = Prisma.FinCardGetPayload<{
  include: { balances: true; statements: true };
}>;

type LoanSnapshotSource = Prisma.FinLoanGetPayload<{
  include: { installments: true };
}>;

export function restoreCatalogLedger(
  tx: Prisma.TransactionClient,
  userId: string,
  snapshot: DeletionSnapshot,
) {
  return restoreLedgerRows(tx, userId, reversedMovements(snapshot));
}

export async function listClearedAccountLinks(
  tx: Prisma.TransactionClient,
  accountId: string,
): Promise<ClearedAccountLink[]> {
  const payments = await tx.finReceivablePayment.findMany({
    where: { accountId },
    select: { id: true },
  });
  const contributions = await tx.finSavingsGoalContribution.findMany({
    where: { accountId },
    select: { id: true },
  });
  return [
    ...payments.map((row) => ({
      model: DELETION_MODEL.receivablePayment,
      rowId: row.id,
      accountId,
    })),
    ...contributions.map((row) => ({
      model: DELETION_MODEL.savingsGoalContribution,
      rowId: row.id,
      accountId,
    })),
  ];
}

/** Cards, their balances and their statements, as rows to restore. */
export function cardSnapshotRows(
  cards: readonly CardSnapshotSource[],
): DeletionRow[] {
  return [
    ...cards.map((card) => ({
      model: DELETION_MODEL.card,
      values: toDeletionValues({
        ...card,
        balances: undefined,
        statements: undefined,
      }),
    })),
    ...cards.flatMap((card) =>
      card.balances.map((balance) => ({
        model: DELETION_MODEL.cardBalance,
        values: toDeletionValues(balance),
      })),
    ),
    ...cards.flatMap((card) =>
      card.statements.map((statement) => ({
        model: DELETION_MODEL.cardStatement,
        values: toDeletionValues(statement),
      })),
    ),
  ];
}

/** Loans and their installments, as rows to restore. */
export function loanSnapshotRows(
  loans: readonly LoanSnapshotSource[],
): DeletionRow[] {
  return [
    ...loans.map((loan) => ({
      model: DELETION_MODEL.loan,
      values: toDeletionValues({ ...loan, installments: undefined }),
    })),
    ...loans.flatMap((loan) =>
      loan.installments.map((installment) => ({
        model: DELETION_MODEL.loanInstallment,
        values: toDeletionValues(installment),
      })),
    ),
  ];
}

export function movementSnapshotRows(
  movements: readonly LedgerTransactionRow[],
): DeletionRow[] {
  return movements.map((movement) => ({
    model: DELETION_MODEL.transaction,
    values: toDeletionValues(movement),
  }));
}
