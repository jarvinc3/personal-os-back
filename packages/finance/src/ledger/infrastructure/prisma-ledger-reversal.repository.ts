import type { DomainEventPublisher } from '@personal-os/contracts';
import { DOMAIN_EVENT_PUBLISHER } from '@personal-os/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService, type Prisma } from '@personal-os/database';
import { FinanceEvents } from '../../contracts';
import type { BudgetSpendSnapshot } from '../../shared/domain/budget-snapshot';
import type { CreateTransactionResult } from '../application/ports/ledger.repository.port';
import {
  adjustBudgetSpent,
  applyBalanceForTransaction,
} from './balance.helpers';
import { ledgerFields, loadCardContext } from './ledger-row-context';
import { enqueueTransactionEvent } from './ledger-transaction-events';
import { revertPlanningLinks } from './planning-link-reversal';

/** Revierte un movimiento o todas las patas de una operación, y avisa. */
import type { LedgerReversalRepositoryPort } from '../application/ports/ledger-reversal.repository.port';
@Injectable()
export class PrismaLedgerReversalRepository implements LedgerReversalRepositoryPort {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(DOMAIN_EVENT_PUBLISHER)
    private readonly events: DomainEventPublisher,
  ) {}

  reverseTransaction(
    userId: string,
    originalId: string,
    aiMetadata?: unknown,
  ): Promise<CreateTransactionResult | null> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.finTransaction.findFirst({
        where: { id: originalId, userId },
      });
      if (!existing) {
        return null;
      }
      if (existing.status === 'REVERSED') {
        return {
          transaction: existing,
          budgetSnapshots: [] as BudgetSpendSnapshot[],
        };
      }

      const claimed = await tx.finTransaction.updateMany({
        where: { id: originalId, userId, status: existing.status },
        data: {
          status: 'REVERSED',
          ...(aiMetadata ? { aiMetadata: aiMetadata } : {}),
        },
      });
      if (claimed.count !== 1) {
        const current = await tx.finTransaction.findFirst({
          where: { id: originalId, userId },
        });
        return current
          ? {
              transaction: current,
              budgetSnapshots: [] as BudgetSpendSnapshot[],
            }
          : null;
      }

      if (existing.status === 'CONFIRMED') {
        await this.revertConfirmedEffect({ tx, userId, existing });
      }

      await revertPlanningLinks(tx, [originalId]);

      const updated = await tx.finTransaction.findFirstOrThrow({
        where: { id: originalId, userId },
        include: {
          account: { select: { id: true, name: true } },
          card: { select: { id: true, name: true } },
        },
      });

      await this.events.enqueue(
        {
          eventName: FinanceEvents.TRANSACTION_REVERSED,
          aggregateType: 'FinTransaction',
          aggregateId: updated.id,
          userId,
          payload: {
            transactionId: updated.id,
            amount: Number(updated.amount),
            status: 'REVERSED',
            source: updated.source,
          },
        },
        tx,
      );

      return {
        transaction: updated,
        budgetSnapshots: [] as BudgetSpendSnapshot[],
      };
    });
  }

  reverseTransactionsByTransferGroupId(
    userId: string,
    transferGroupId: string,
  ): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.finTransaction.findMany({
        where: { userId, transferGroupId },
      });
      const reversedIds: string[] = [];
      for (const row of rows) {
        if (row.status !== 'CONFIRMED') {
          continue;
        }
        const claimed = await tx.finTransaction.updateMany({
          where: { id: row.id, userId, status: 'CONFIRMED' },
          data: { status: 'REVERSED' },
        });
        if (claimed.count === 0) {
          continue;
        }
        await this.revertConfirmedEffect({ tx, userId, existing: row });
        reversedIds.push(row.id);
      }
      if (reversedIds.length > 0) {
        for (const transactionId of reversedIds) {
          await enqueueTransactionEvent({
            tx,
            events: this.events,
            userId,
            eventName: FinanceEvents.TRANSACTION_REVERSED,
            transactionId,
          });
        }
      }
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
  }): Promise<void> {
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
    await adjustBudgetSpent(tx, {
      userId,
      categoryId: existing.categoryId,
      type: existing.type,
      amountBaseCurrency: Number(existing.amountBaseCurrency),
      transactionDate: existing.transactionDate,
      direction: -1,
    });
  }
}
