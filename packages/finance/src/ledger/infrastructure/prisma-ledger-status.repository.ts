import type { DomainEventPublisher } from '@personal-os/contracts';
import { DOMAIN_EVENT_PUBLISHER } from '@personal-os/contracts';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService, type Prisma } from '@personal-os/database';
import { FinanceEvents } from '../../contracts';
import type { BudgetThresholdPort } from '../../shared/application/budget-threshold.port';
import { BUDGET_THRESHOLD_PORT } from '../../shared/application/tokens';
import type { BudgetSpendSnapshot } from '../../shared/domain/budget-snapshot';
import type { CreateTransactionResult } from '../application/ports/ledger.repository.port';
import {
  adjustBudgetSpent,
  applyBalanceForTransaction,
} from './balance.helpers';
import { ledgerFields, loadCardContext } from './ledger-row-context';
import { enqueueTransactionEvent } from './ledger-transaction-events';

/**
 * Confirmar y desconfirmar movimientos. La transición se reclama con un
 * `updateMany` condicionado por el estado leído: dos peticiones simultáneas no
 * aplican el saldo dos veces.
 */
import type { LedgerStatusRepositoryPort } from '../application/ports/ledger-status.repository.port';
@Injectable()
export class PrismaLedgerStatusRepository implements LedgerStatusRepositoryPort {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(DOMAIN_EVENT_PUBLISHER)
    private readonly events: DomainEventPublisher,
    @Optional()
    @Inject(BUDGET_THRESHOLD_PORT)
    private readonly thresholds?: BudgetThresholdPort,
  ) {}

  confirmTransaction(
    userId: string,
    id: string,
  ): Promise<CreateTransactionResult | null> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.finTransaction.findFirst({
        where: { id, userId },
      });
      if (!existing) {
        return null;
      }
      if (existing.status === 'CONFIRMED') {
        return this.readTransactionResult(tx, userId, id);
      }

      const claimed = await tx.finTransaction.updateMany({
        where: { id, userId, status: existing.status },
        data: { status: 'CONFIRMED' },
      });
      if (claimed.count === 0) {
        return this.readTransactionResult(tx, userId, id);
      }

      const budgetSnapshots = await this.applyConfirmedEffect({
        tx,
        userId,
        existing,
      });
      const updated = await this.readTransactionForResponse(tx, userId, id);
      if (!updated) {
        return null;
      }

      await enqueueTransactionEvent({
        tx,
        events: this.events,
        userId,
        eventName: FinanceEvents.TRANSACTION_CONFIRMED,
        transactionId: updated.id,
      });
      await enqueueTransactionEvent({
        tx,
        events: this.events,
        userId,
        eventName: FinanceEvents.TRANSACTION_UPDATED,
        transactionId: updated.id,
      });
      await this.thresholds?.processThresholds(userId, budgetSnapshots, tx);

      return {
        transaction: updated,
        budgetSnapshots,
      };
    });
  }

  confirmTransactionsByTransferGroupId(
    userId: string,
    transferGroupId: string,
  ): Promise<{ count: number; budgetSnapshots: BudgetSpendSnapshot[] }> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.finTransaction.findMany({
        where: { userId, transferGroupId, status: 'PENDING' },
      });

      const budgetSnapshots: BudgetSpendSnapshot[] = [];
      const confirmedTransactionIds: string[] = [];

      for (const row of rows) {
        const claimed = await tx.finTransaction.updateMany({
          where: { id: row.id, userId, status: 'PENDING' },
          data: { status: 'CONFIRMED' },
        });
        if (claimed.count === 0) {
          continue;
        }
        const snapshots = await this.applyConfirmedEffect({
          tx,
          userId,
          existing: row,
        });
        budgetSnapshots.push(...snapshots);
        confirmedTransactionIds.push(row.id);
      }

      for (const transactionId of confirmedTransactionIds) {
        await enqueueTransactionEvent({
          tx,
          events: this.events,
          userId,
          eventName: FinanceEvents.TRANSACTION_CONFIRMED,
          transactionId,
        });
      }

      await this.thresholds?.processThresholds(userId, budgetSnapshots, tx);
      return { count: confirmedTransactionIds.length, budgetSnapshots };
    });
  }

  unconfirmTransaction(
    userId: string,
    id: string,
  ): Promise<CreateTransactionResult | null> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.finTransaction.findFirst({
        where: { id, userId },
      });
      if (!existing) {
        return null;
      }
      if (existing.status !== 'CONFIRMED') {
        return this.readTransactionResult(tx, userId, id);
      }

      const claimed = await tx.finTransaction.updateMany({
        where: { id, userId, status: 'CONFIRMED' },
        data: { status: 'PENDING' },
      });
      if (claimed.count === 0) {
        return this.readTransactionResult(tx, userId, id);
      }

      await this.revertConfirmedEffect({ tx, userId, existing });
      await enqueueTransactionEvent({
        tx,
        events: this.events,
        userId,
        eventName: FinanceEvents.TRANSACTION_UPDATED,
        transactionId: id,
      });

      const updated = await this.readTransactionForResponse(tx, userId, id);
      if (!updated) {
        return null;
      }

      return {
        transaction: updated,
        budgetSnapshots: [] as BudgetSpendSnapshot[],
      };
    });
  }

  unconfirmTransactionsByTransferGroupId(
    userId: string,
    transferGroupId: string,
  ): Promise<{ count: number; budgetSnapshots: BudgetSpendSnapshot[] }> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.finTransaction.findMany({
        where: { userId, transferGroupId },
      });
      const budgetSnapshots: BudgetSpendSnapshot[] = [];
      const unconfirmedIds: string[] = [];
      for (const row of rows) {
        if (row.status !== 'CONFIRMED') {
          continue;
        }
        const claimed = await tx.finTransaction.updateMany({
          where: { id: row.id, userId, status: 'CONFIRMED' },
          data: { status: 'PENDING' },
        });
        if (claimed.count === 0) {
          continue;
        }
        const snapshots = await this.revertConfirmedEffect({
          tx,
          userId,
          existing: row,
        });
        budgetSnapshots.push(...snapshots);
        unconfirmedIds.push(row.id);
      }
      if (unconfirmedIds.length > 0) {
        for (const transactionId of unconfirmedIds) {
          await enqueueTransactionEvent({
            tx,
            events: this.events,
            userId,
            eventName: FinanceEvents.TRANSACTION_UPDATED,
            transactionId,
          });
        }
      }
      return { count: unconfirmedIds.length, budgetSnapshots };
    });
  }

  private async applyConfirmedEffect({
    tx,
    userId,
    existing,
  }: {
    tx: Prisma.TransactionClient;
    userId: string;
    existing: Prisma.FinTransactionGetPayload<object>;
  }): Promise<BudgetSpendSnapshot[]> {
    const context = await loadCardContext({
      tx,
      userId,
      cardId: existing.cardId,
    });
    const ledger = ledgerFields(existing);
    await applyBalanceForTransaction(tx, {
      accountId: existing.accountId,
      cardId: existing.cardId,
      cardType: context.cardType,
      derivedAccountId: context.derivedAccountId,
      currency: ledger.currency,
      type: existing.type,
      amount: ledger.amount,
    });
    return adjustBudgetSpent(tx, {
      userId,
      categoryId: existing.categoryId,
      type: existing.type,
      amountBaseCurrency: Number(existing.amountBaseCurrency),
      transactionDate: existing.transactionDate,
    });
  }

  private async revertConfirmedEffect({
    tx,
    userId,
    existing,
  }: {
    tx: Prisma.TransactionClient;
    userId: string;
    existing: Prisma.FinTransactionGetPayload<object>;
  }): Promise<BudgetSpendSnapshot[]> {
    const context = await loadCardContext({
      tx,
      userId,
      cardId: existing.cardId,
    });
    const ledger = ledgerFields(existing);
    await applyBalanceForTransaction(tx, {
      accountId: existing.accountId,
      cardId: existing.cardId,
      cardType: context.cardType,
      derivedAccountId: context.derivedAccountId,
      currency: ledger.currency,
      type: existing.type,
      amount: ledger.amount,
      direction: -1,
    });
    return adjustBudgetSpent(tx, {
      userId,
      categoryId: existing.categoryId,
      type: existing.type,
      amountBaseCurrency: Number(existing.amountBaseCurrency),
      transactionDate: existing.transactionDate,
      direction: -1,
    });
  }

  private readTransactionForResponse(
    tx: Prisma.TransactionClient,
    userId: string,
    id: string,
  ) {
    return tx.finTransaction.findFirst({
      where: { id, userId },
      include: {
        account: { select: { id: true, name: true } },
        card: { select: { id: true, name: true } },
      },
    });
  }

  private async readTransactionResult(
    tx: Prisma.TransactionClient,
    userId: string,
    id: string,
  ): Promise<CreateTransactionResult | null> {
    const transaction = await this.readTransactionForResponse(tx, userId, id);
    return transaction ? { transaction, budgetSnapshots: [] } : null;
  }
}
