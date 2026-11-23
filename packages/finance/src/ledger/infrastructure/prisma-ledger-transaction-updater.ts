import { NotFoundException } from '@nestjs/common';
import type { DomainEventPublisher } from '@personal-os/contracts';
import type { Prisma, PrismaService } from '@personal-os/database';
import { FinanceEvents } from '../../contracts';
import type { BudgetThresholdPort } from '../../shared/application/budget-threshold.port';
import type { BudgetSpendSnapshot } from '../../shared/domain/budget-snapshot';
import type { ResolvedAmounts } from '../../shared/domain/money';
import type { TransactionUpdateFields } from '../application/commands/ledger.commands';
import type {
  CreateTransactionResult,
  LedgerTransactionRow,
} from '../application/ports/ledger.repository.port';
import {
  adjustBudgetSpent,
  applyBalanceForTransaction,
  resolveLedgerTarget,
  type LedgerTarget,
} from './balance.helpers';
import { ledgerFields, loadCardContext } from './ledger-row-context';
import { enqueueTransactionEvent } from './ledger-transaction-events';
import type { TransferFeeLeg } from './prisma-ledger-transfer-fee';
import { buildUpdateData } from './transaction-update-fields';

const transactionPartiesInclude = {
  account: { select: { id: true, name: true } },
  card: { select: { id: true, name: true } },
} satisfies Prisma.FinTransactionInclude;

type TransactionRow = Prisma.FinTransactionGetPayload<object>;
type TransactionWithParties = Prisma.FinTransactionGetPayload<{
  include: typeof transactionPartiesInclude;
}>;

type TransactionUpdaterDeps = {
  prisma: PrismaService;
  events: DomainEventPublisher;
  thresholds?: BudgetThresholdPort;
  feeLeg: TransferFeeLeg;
};

/** Ediciones que revierten el efecto anterior y reaplican el nuevo. */
export class PrismaLedgerTransactionUpdater {
  constructor(private readonly deps: TransactionUpdaterDeps) {}

  async updateTransfer(input: {
    userId: string;
    debitId: string;
    creditId: string;
    debitTarget: { accountId: string | null; cardId: string | null };
    creditTarget: { accountId: string | null; cardId: string | null };
    fromAmounts: ResolvedAmounts;
    toAmounts: ResolvedAmounts;
    estimated: boolean;
    transactionDate: Date;
    description?: string | null;
    notes?: string | null;
    feeAmounts?: ResolvedAmounts;
    feeCategoryId?: string | null;
  }): Promise<{
    debit: LedgerTransactionRow;
    credit: LedgerTransactionRow;
  } | null> {
    return this.deps.prisma.$transaction(async (tx) => {
      const sharedFields = {
        transactionDate: input.transactionDate,
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      };
      const debit = await this.applyTransactionUpdate({
        tx,
        userId: input.userId,
        id: input.debitId,
        fields: {
          accountId: input.debitTarget.accountId,
          cardId: input.debitTarget.cardId,
          amount: input.fromAmounts.amount,
          currency: input.fromAmounts.currency,
          ledgerAmount: input.fromAmounts.ledgerAmount,
          ledgerCurrency: input.fromAmounts.ledgerCurrency,
          amountBaseCurrency: input.fromAmounts.amountBaseCurrency,
          exchangeRate: input.fromAmounts.exchangeRate,
          isEstimated: input.estimated,
          ...sharedFields,
        },
      });
      const credit = await this.applyTransactionUpdate({
        tx,
        userId: input.userId,
        id: input.creditId,
        fields: {
          accountId: input.creditTarget.accountId,
          cardId: input.creditTarget.cardId,
          amount: input.toAmounts.amount,
          currency: input.toAmounts.currency,
          ledgerAmount: input.toAmounts.ledgerAmount,
          ledgerCurrency: input.toAmounts.ledgerCurrency,
          amountBaseCurrency: input.toAmounts.amountBaseCurrency,
          exchangeRate: input.toAmounts.exchangeRate,
          isEstimated: input.estimated,
          ...sharedFields,
        },
      });
      if (!debit || !credit) {
        throw new NotFoundException(
          'Movimiento de la transferencia no encontrado',
        );
      }
      if (input.feeAmounts) {
        await this.deps.feeLeg.upsert(tx, {
          userId: input.userId,
          transferGroupId: debit.transaction.transferGroupId,
          source: debit.transaction,
          feeAmounts: input.feeAmounts,
          feeCategoryId: input.feeCategoryId,
        });
      }
      return { debit: debit.transaction, credit: credit.transaction };
    });
  }

  async updateTransaction(
    userId: string,
    id: string,
    fields: TransactionUpdateFields,
  ): Promise<CreateTransactionResult | null> {
    return this.deps.prisma.$transaction((tx) =>
      this.applyTransactionUpdate({ tx, userId, id, fields }),
    );
  }

  private async applyTransactionUpdate({
    tx,
    userId,
    id,
    fields,
  }: {
    tx: Prisma.TransactionClient;
    userId: string;
    id: string;
    fields: TransactionUpdateFields;
  }): Promise<CreateTransactionResult | null> {
    const existing = await tx.finTransaction.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      return null;
    }

    const updateData = buildUpdateData(fields);
    const nextTarget = await resolveLedgerTarget(
      tx,
      userId,
      fields.accountId !== undefined ? fields.accountId : existing.accountId,
      fields.cardId !== undefined ? fields.cardId : existing.cardId,
    );
    if (!nextTarget) {
      return null;
    }
    updateData.accountId = nextTarget.accountId;
    updateData.cardId = nextTarget.cardId;

    if (existing.status === 'CONFIRMED') {
      await this.revertConfirmedEffect({ tx, userId, existing });
    }

    await tx.finTransaction.updateMany({
      where: { id, userId },
      data: updateData,
    });

    const updated = await tx.finTransaction.findFirst({
      where: { id, userId },
      include: transactionPartiesInclude,
    });
    if (!updated) {
      return null;
    }

    const budgetSnapshots = await this.applyConfirmedEffect({
      tx,
      userId,
      updated,
      nextTarget,
    });

    await enqueueTransactionEvent({
      tx,
      events: this.deps.events,
      userId,
      eventName: FinanceEvents.TRANSACTION_UPDATED,
      transactionId: updated.id,
    });
    await this.deps.thresholds?.processThresholds(userId, budgetSnapshots, tx);

    return {
      transaction: updated,
      budgetSnapshots,
    };
  }

  private async revertConfirmedEffect({
    tx,
    userId,
    existing,
  }: {
    tx: Prisma.TransactionClient;
    userId: string;
    existing: TransactionRow;
  }): Promise<void> {
    const previous = await loadCardContext({
      tx,
      userId,
      cardId: existing.cardId,
    });
    const previousLedger = ledgerFields(existing);
    await applyBalanceForTransaction(tx, {
      accountId: existing.accountId,
      cardId: existing.cardId,
      cardType: previous.cardType,
      derivedAccountId: previous.derivedAccountId,
      currency: previousLedger.currency,
      type: existing.type,
      amount: previousLedger.amount,
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

  private async applyConfirmedEffect({
    tx,
    userId,
    updated,
    nextTarget,
  }: {
    tx: Prisma.TransactionClient;
    userId: string;
    updated: TransactionWithParties;
    nextTarget: LedgerTarget;
  }): Promise<BudgetSpendSnapshot[]> {
    if (updated.status !== 'CONFIRMED') {
      return [];
    }
    const nextLedger = ledgerFields(updated);
    await applyBalanceForTransaction(tx, {
      accountId: updated.accountId,
      cardId: updated.cardId,
      cardType: nextTarget.cardType,
      derivedAccountId: nextTarget.derivedAccountId,
      currency: nextLedger.currency,
      type: updated.type,
      amount: nextLedger.amount,
    });
    return adjustBudgetSpent(tx, {
      userId,
      categoryId: updated.categoryId,
      type: updated.type,
      amountBaseCurrency: Number(updated.amountBaseCurrency),
      transactionDate: updated.transactionDate,
    });
  }
}
