import type { DomainEventPublisher } from '@personal-os/contracts';
import { DOMAIN_EVENT_PUBLISHER } from '@personal-os/contracts';
import { FinanceEvents } from '../../contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { FinTransactionType, Prisma } from '@personal-os/database';
import { PrismaService } from '@personal-os/database';
import {
  DELETION_ENTITY,
  DELETION_MODEL,
  reversedMovements,
  toDeletionValues,
  type DeletionRow,
  type StoredMovement,
  type UpdatedRow,
} from '../../shared/domain/deletion-snapshot';
import { DeletionJournalRepository } from '../../shared/infrastructure/deletion-journal.repository';
import type { LedgerTransactionRow } from '../application/ports/ledger.repository.port';
import {
  adjustBudgetSpent,
  applyBalanceForTransaction,
  restoreLedgerRows,
} from './balance.helpers';
import { ledgerFields, loadCardContext } from './ledger-row-context';
import { revertPlanningLinks } from './planning-link-reversal';

type TxClient = Prisma.TransactionClient;

/**
 * Removes and restores ledger rows. Every removal takes the movement's balances,
 * planning links and budget effect with it, snapshots the whole thing in the
 * deletion journal and announces the deletion, so the trash can put it back.
 */
@Injectable()
export class PrismaLedgerDeletionRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(DOMAIN_EVENT_PUBLISHER)
    private readonly events: DomainEventPublisher,
    private readonly journal: DeletionJournalRepository,
  ) {}

  deleteTransaction(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.finTransaction.findFirst({
        where: { id, userId, source: 'MANUAL' },
      });
      if (!existing) {
        return { count: 0 };
      }

      const claimed = await tx.finTransaction.updateMany({
        where: { id, userId, source: 'MANUAL', status: existing.status },
        data: { status: 'CANCELLED' },
      });
      if (claimed.count === 0) {
        return { count: 0 };
      }

      if (existing.status === 'CONFIRMED') {
        const ctx = await loadCardContext({
          tx,
          userId,
          cardId: existing.cardId,
        });
        const ledger = ledgerFields(existing);
        await applyBalanceForTransaction(tx, {
          accountId: existing.accountId,
          cardId: existing.cardId,
          cardType: ctx.cardType,
          derivedAccountId: ctx.derivedAccountId,
          currency: ledger.currency,
          type: existing.type,
          amount: ledger.amount,
          direction: -1,
        });
        await adjustBudgetSpent(tx, {
          userId,
          categoryId: existing.categoryId,
          type: existing.type,
          amountBaseCurrency: Number(existing.amountBaseCurrency),
          transactionDate: existing.transactionDate,
          direction: -1,
        });
      }

      const links = await this.snapshotPlanningLinks(tx, [existing.id]);
      await this.journal.record(tx, {
        userId,
        entityType: DELETION_ENTITY.transaction,
        entityId: id,
        snapshot: {
          rows: [
            {
              model: DELETION_MODEL.transaction,
              values: toDeletionValues(existing),
            },
            ...links.rows,
          ],
          updates: links.updates,
          ledgerReversed: [existing.id],
        },
      });

      await revertPlanningLinks(tx, [existing.id]);
      await this.enqueueTransactionDeleted(tx, userId, existing);

      return tx.finTransaction.deleteMany({
        where: { id, userId, source: 'MANUAL' },
      });
    });
  }

  deleteTransactionsByTransferGroupId(userId: string, transferGroupId: string) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.finTransaction.findMany({
        where: { userId, transferGroupId, source: 'MANUAL' },
      });
      if (rows.length === 0) {
        return { count: 0 };
      }

      const claimedRows: typeof rows = [];
      for (const row of rows) {
        const claimed = await tx.finTransaction.updateMany({
          where: { id: row.id, userId, source: 'MANUAL', status: row.status },
          data: { status: 'CANCELLED' },
        });
        if (claimed.count === 1) {
          claimedRows.push(row);
        }
      }
      if (claimedRows.length === 0) {
        return { count: 0 };
      }

      const links = await this.snapshotPlanningLinks(
        tx,
        claimedRows.map((row) => row.id),
      );
      await this.journal.record(tx, {
        userId,
        entityType: DELETION_ENTITY.transaction,
        entityId: transferGroupId,
        snapshot: {
          rows: [
            ...claimedRows.map((row) => ({
              model: DELETION_MODEL.transaction,
              values: toDeletionValues(row),
            })),
            ...links.rows,
          ],
          updates: links.updates,
          ledgerReversed: claimedRows.map((row) => row.id),
        },
      });

      for (const row of claimedRows) {
        if (row.status === 'CONFIRMED') {
          const ctx = await loadCardContext({
            tx,
            userId,
            cardId: row.cardId,
          });
          const ledger = ledgerFields(row);
          await applyBalanceForTransaction(tx, {
            accountId: row.accountId,
            cardId: row.cardId,
            cardType: ctx.cardType,
            derivedAccountId: ctx.derivedAccountId,
            currency: ledger.currency,
            type: row.type,
            amount: ledger.amount,
            direction: -1,
          });
          await adjustBudgetSpent(tx, {
            userId,
            categoryId: row.categoryId,
            type: row.type,
            amountBaseCurrency: Number(row.amountBaseCurrency),
            transactionDate: row.transactionDate,
            direction: -1,
          });
        }
      }

      await revertPlanningLinks(
        tx,
        claimedRows.map((row) => row.id),
      );
      for (const row of claimedRows) {
        await this.enqueueTransactionDeleted(tx, userId, row);
      }

      return tx.finTransaction.deleteMany({
        where: {
          id: { in: claimedRows.map((row) => row.id) },
          userId,
          source: 'MANUAL',
        },
      });
    });
  }

  purgeLedgerForAccount(userId: string, accountId: string) {
    return this.prisma.$transaction(async (tx) => {
      const cards = await tx.finCard.findMany({
        where: { userId, accountId },
        select: { id: true },
      });
      const cardIds = cards.map((card) => card.id);
      const instrumentRows = await tx.finTransaction.findMany({
        where: {
          userId,
          OR: [
            { accountId },
            ...(cardIds.length > 0 ? [{ cardId: { in: cardIds } }] : []),
          ],
        },
      });
      return this.purgeInstrumentRows(tx, userId, instrumentRows);
    });
  }

  purgeLedgerForCard(userId: string, cardId: string) {
    return this.prisma.$transaction(async (tx) => {
      const instrumentRows = await tx.finTransaction.findMany({
        where: { userId, cardId },
      });
      return this.purgeInstrumentRows(tx, userId, instrumentRows);
    });
  }

  private async purgeInstrumentRows(
    tx: TxClient,
    userId: string,
    instrumentRows: readonly LedgerTransactionRow[],
  ) {
    const groupIds = [
      ...new Set(
        instrumentRows
          .map((row) => row.transferGroupId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const groupRows =
      groupIds.length === 0
        ? []
        : await tx.finTransaction.findMany({
            where: { userId, transferGroupId: { in: groupIds } },
          });
    const byId = new Map(instrumentRows.map((row) => [row.id, row]));
    for (const row of groupRows) {
      byId.set(row.id, row);
    }
    const rows = [...byId.values()];
    if (rows.length === 0) {
      return { count: 0, rows: [] };
    }

    for (const row of rows) {
      if (row.status === 'CONFIRMED') {
        const ctx = await loadCardContext({
          tx,
          userId,
          cardId: row.cardId,
        });
        const ledger = ledgerFields(row);
        await applyBalanceForTransaction(tx, {
          accountId: row.accountId,
          cardId: row.cardId,
          cardType: ctx.cardType,
          derivedAccountId: ctx.derivedAccountId,
          currency: ledger.currency,
          type: row.type as FinTransactionType,
          amount: ledger.amount,
          direction: -1,
        });
        await adjustBudgetSpent(tx, {
          userId,
          categoryId: row.categoryId,
          type: row.type as FinTransactionType,
          amountBaseCurrency: Number(row.amountBaseCurrency ?? row.amount),
          transactionDate: row.transactionDate,
          direction: -1,
        });
      }
    }

    for (const row of rows) {
      await this.enqueueTransactionDeleted(tx, userId, row);
    }

    await tx.finTransaction.deleteMany({
      where: { userId, id: { in: rows.map((row) => row.id) } },
    });
    return { count: rows.length, rows };
  }

  /** Applies again what `purgeInstrumentRows` and `deleteTransaction` reversed. */
  restoreLedgerTransactions(
    userId: string,
    movements: readonly StoredMovement[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      await restoreLedgerRows(tx, userId, movements);
      return { count: movements.length };
    });
  }

  restoreTransaction(userId: string, id: string, now: Date) {
    return this.journal.restore(
      userId,
      DELETION_ENTITY.transaction,
      id,
      now,
      (tx, snapshot) =>
        restoreLedgerRows(tx, userId, reversedMovements(snapshot)),
    );
  }

  /**
   * Rows the planning links touch before `revertPlanningLinks` runs: the ones
   * it deletes go in `rows`, the ones it changes in place go in `updates`.
   */
  private async snapshotPlanningLinks(
    tx: TxClient,
    transactionIds: readonly string[],
  ): Promise<{ rows: DeletionRow[]; updates: UpdatedRow[] }> {
    const ids = [...transactionIds];
    const payments = await tx.finReceivablePayment.findMany({
      where: { transactionId: { in: ids } },
    });
    const contributions = await tx.finSavingsGoalContribution.findMany({
      where: { transactionId: { in: ids } },
    });
    const installments = await tx.finLoanInstallment.findMany({
      where: { transactionId: { in: ids } },
    });
    const receivableIds = [
      ...new Set(payments.map((payment) => payment.receivableId)),
    ];
    const goalIds = [
      ...new Set(contributions.map((contribution) => contribution.goalId)),
    ];
    const loanIds = [
      ...new Set(installments.map((installment) => installment.loanId)),
    ];
    const receivables =
      receivableIds.length === 0
        ? []
        : await tx.finReceivable.findMany({
            where: { id: { in: receivableIds } },
          });
    const goals =
      goalIds.length === 0
        ? []
        : await tx.finSavingsGoal.findMany({ where: { id: { in: goalIds } } });
    const loans =
      loanIds.length === 0
        ? []
        : await tx.finLoan.findMany({ where: { id: { in: loanIds } } });

    return {
      rows: [
        ...payments.map((payment) => ({
          model: DELETION_MODEL.receivablePayment,
          values: toDeletionValues(payment),
        })),
        ...contributions.map((contribution) => ({
          model: DELETION_MODEL.savingsGoalContribution,
          values: toDeletionValues(contribution),
        })),
      ],
      updates: [
        ...receivables.map((receivable) => ({
          model: DELETION_MODEL.receivable,
          id: receivable.id,
          values: toDeletionValues(receivable),
        })),
        ...goals.map((goal) => ({
          model: DELETION_MODEL.savingsGoal,
          id: goal.id,
          values: toDeletionValues(goal),
        })),
        ...installments.map((installment) => ({
          model: DELETION_MODEL.loanInstallment,
          id: installment.id,
          values: toDeletionValues(installment),
        })),
        ...loans.map((loan) => ({
          model: DELETION_MODEL.loan,
          id: loan.id,
          values: toDeletionValues(loan),
        })),
      ],
    };
  }

  private async enqueueTransactionDeleted(
    tx: TxClient,
    userId: string,
    row: {
      id: string;
      amount: { toString(): string } | number;
      status: string;
      source: string;
      transferGroupId: string | null;
    },
  ) {
    await this.events.enqueue(
      {
        eventName: FinanceEvents.TRANSACTION_DELETED,
        aggregateType: 'FinTransaction',
        aggregateId: row.id,
        userId,
        payload: {
          transactionId: row.id,
          transferGroupId: row.transferGroupId,
          amount: Number(row.amount),
          status: row.status,
          source: row.source,
        },
      },
      tx,
    );
  }
}
