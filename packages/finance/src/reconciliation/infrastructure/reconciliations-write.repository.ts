import { Injectable } from '@nestjs/common';
import type { Prisma } from '@personal-os/database';
import { PrismaService } from '@personal-os/database';
import {
  DELETION_ENTITY,
  DELETION_MODEL,
  reversedMovements,
  toDeletionValues,
} from '../../shared/domain/deletion-snapshot';
import { DeletionJournalRepository } from '../../shared/infrastructure/deletion-journal.repository';
import {
  applyBalanceForTransaction,
  resolveLedgerTarget,
  restoreLedgerRows,
} from '../../ledger/infrastructure/balance.helpers';
import {
  SYSTEM_KIND_BY_ADJUSTMENT_KIND,
  type ReconciliationAdjustmentKind,
} from '../domain/reconciliation-adjustment';
import {
  ADJUSTMENT_DESCRIPTION,
  reconciliationInclude,
  type CreateReconciliationInput,
  type ReconciliationRow,
} from './reconciliations-types';

/** Escrituras de la conciliación: crear con ajustes, borrar y restaurar. */
@Injectable()
export class ReconciliationsWriteRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: DeletionJournalRepository,
  ) {}

  async create(
    userId: string,
    input: CreateReconciliationInput,
  ): Promise<ReconciliationRow> {
    return this.prisma.$transaction(async (tx) => {
      const ledgerTarget = await resolveLedgerTarget(
        tx,
        userId,
        input.target.accountId,
        input.target.cardId,
      );
      if (!ledgerTarget) {
        throw new Error('Reconciliation target no longer exists');
      }

      const reconciliation = await tx.finReconciliation.create({
        data: {
          userId,
          accountId: input.target.accountId,
          cardId: input.target.cardId,
          currency: input.target.currency,
          asOfDate: input.asOfDate,
          appBalance: input.appBalance,
          realBalance: input.realBalance,
          difference: input.difference,
          note: input.note,
        },
      });

      for (const adjustment of input.adjustments) {
        const categoryId = await this.findSystemCategoryId(tx, adjustment.kind);
        const created = await tx.finTransaction.create({
          data: {
            userId,
            accountId: ledgerTarget.accountId,
            cardId: ledgerTarget.cardId,
            categoryId,
            type: 'ADJUSTMENT',
            amount: adjustment.amounts.amount,
            ledgerAmount: adjustment.amounts.ledgerAmount,
            amountBaseCurrency: adjustment.amounts.amountBaseCurrency,
            currency: adjustment.amounts.currency,
            ledgerCurrency: adjustment.amounts.ledgerCurrency,
            exchangeRate: adjustment.amounts.exchangeRate,
            description: ADJUSTMENT_DESCRIPTION,
            source: 'MANUAL',
            status: 'CONFIRMED',
            transactionDate: input.asOfDate,
          },
        });

        await applyBalanceForTransaction(tx, {
          accountId: ledgerTarget.accountId,
          cardId: ledgerTarget.cardId,
          cardType: ledgerTarget.cardType,
          derivedAccountId: ledgerTarget.derivedAccountId,
          currency: adjustment.amounts.ledgerCurrency,
          type: 'ADJUSTMENT',
          amount: adjustment.amounts.ledgerAmount,
        });

        await tx.finReconciliationAdjustment.create({
          data: {
            reconciliationId: reconciliation.id,
            transactionId: created.id,
            kind: adjustment.kind,
            amount: adjustment.amounts.ledgerAmount,
          },
        });
      }

      return tx.finReconciliation.findFirstOrThrow({
        where: { id: reconciliation.id },
        include: reconciliationInclude,
      });
    });
  }

  async delete(
    userId: string,
    id: string,
  ): Promise<{ count: number; notLatest: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const reconciliation = await tx.finReconciliation.findFirst({
        where: { id, userId },
        include: {
          adjustments: { include: { transaction: true } },
        },
      });
      if (!reconciliation) {
        return { count: 0, notLatest: false };
      }

      const latest = await tx.finReconciliation.findFirst({
        where: {
          userId,
          currency: reconciliation.currency,
          ...(reconciliation.accountId
            ? { accountId: reconciliation.accountId }
            : { cardId: reconciliation.cardId }),
        },
        orderBy: [{ asOfDate: 'desc' }, { createdAt: 'desc' }],
        select: { id: true },
      });
      if (latest?.id !== reconciliation.id) {
        return { count: 0, notLatest: true };
      }

      const movements = reconciliation.adjustments.map(
        (adjustment) => adjustment.transaction,
      );
      for (const movement of movements) {
        await this.revertAdjustmentBalance(tx, userId, movement);
      }

      const reconciliationRow: Record<string, unknown> = {
        ...reconciliation,
      };
      delete reconciliationRow.adjustments;
      await this.journal.record(tx, {
        userId,
        entityType: DELETION_ENTITY.reconciliation,
        entityId: id,
        snapshot: {
          rows: [
            {
              model: DELETION_MODEL.reconciliation,
              values: toDeletionValues(reconciliationRow),
            },
            ...movements.map((movement) => ({
              model: DELETION_MODEL.transaction,
              values: toDeletionValues(movement),
            })),
            ...reconciliation.adjustments.map((adjustment) => ({
              model: DELETION_MODEL.reconciliationAdjustment,
              values: toDeletionValues({
                id: adjustment.id,
                reconciliationId: adjustment.reconciliationId,
                transactionId: adjustment.transactionId,
                kind: adjustment.kind,
                amount: adjustment.amount,
              }),
            })),
          ],
          ledgerReversed: movements.map((movement) => movement.id),
        },
      });

      await tx.finReconciliationAdjustment.deleteMany({
        where: { reconciliationId: id },
      });
      await tx.finTransaction.deleteMany({
        where: { id: { in: movements.map((movement) => movement.id) } },
      });
      await tx.finReconciliation.delete({ where: { id } });

      return { count: 1, notLatest: false };
    });
  }

  restore(userId: string, id: string, now: Date) {
    return this.journal.restore(
      userId,
      DELETION_ENTITY.reconciliation,
      id,
      now,
      (tx, snapshot) =>
        restoreLedgerRows(tx, userId, reversedMovements(snapshot)),
    );
  }

  private async revertAdjustmentBalance(
    tx: Prisma.TransactionClient,
    userId: string,
    movement: {
      accountId: string | null;
      cardId: string | null;
      ledgerCurrency: string;
      ledgerAmount: unknown;
    },
  ): Promise<void> {
    const card = movement.cardId
      ? await tx.finCard.findFirst({
          where: { id: movement.cardId, userId },
          select: { type: true, accountId: true },
        })
      : null;
    await applyBalanceForTransaction(tx, {
      accountId: movement.accountId,
      cardId: movement.cardId,
      cardType: card?.type ?? null,
      derivedAccountId: card?.type === 'DEBIT' ? card.accountId : null,
      currency: movement.ledgerCurrency,
      type: 'ADJUSTMENT',
      amount: Number(movement.ledgerAmount),
      direction: -1,
    });
  }

  private async findSystemCategoryId(
    tx: Prisma.TransactionClient,
    kind: ReconciliationAdjustmentKind,
  ): Promise<string | null> {
    const category = await tx.finCategory.findFirst({
      where: {
        isSystem: true,
        systemKind: SYSTEM_KIND_BY_ADJUSTMENT_KIND[kind],
        type: 'EXPENSE',
      },
      select: { id: true },
    });
    return category?.id ?? null;
  }
}
