import { Inject, Injectable, Optional } from '@nestjs/common';
import { AppEvents } from '@personal-os/core';
import type { FinTransactionType, Prisma } from '@personal-os/database';
import { PrismaService } from '@personal-os/database';
import { randomUUID } from 'crypto';
import type { DomainEventPublisherPort } from '../../events/application/ports/domain-event-publisher.port';
import type { BudgetThresholdPort } from '../../shared/application/budget-threshold.port';
import type { SubscriptionMatcherPort } from '../../shared/application/subscription-matcher.port';
import {
  BUDGET_THRESHOLD_PORT,
  DOMAIN_EVENT_PUBLISHER,
  SUBSCRIPTION_MATCHER,
} from '../../shared/application/tokens';
import type { BudgetSpendSnapshot } from '../../shared/domain/budget-snapshot';
import { transactionCreatedEventName } from '../../shared/domain/mappers';
import { statusAffectsLedger } from '../../shared/domain/transaction-status';
import type { ImportEmailTransactionCommand } from '../application/commands/ledger.commands';
import type {
  CreateTransferResult,
  EmailTransferCounterpart,
} from '../application/ports/ledger.repository.port';
import {
  adjustBudgetSpent,
  applyBalanceForTransaction,
  resolveLedgerTarget,
} from './balance.helpers';
import { enqueueTransactionEvent } from './ledger-transaction-events';

type TxClient = Prisma.TransactionClient;

/**
 * Movements that come from email: the first leg, its counterpart and the pair
 * of legs that turn two imported movements into one transfer.
 */
@Injectable()
export class PrismaLedgerEmailImportRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(DOMAIN_EVENT_PUBLISHER)
    private readonly events: DomainEventPublisherPort,
    @Optional()
    @Inject(BUDGET_THRESHOLD_PORT)
    private readonly thresholds?: BudgetThresholdPort,
    @Optional()
    @Inject(SUBSCRIPTION_MATCHER)
    private readonly subscriptionMatcher?: SubscriptionMatcherPort,
  ) {}

  createEmailImportTransaction(
    userId: string,
    data: ImportEmailTransactionCommand,
  ) {
    const imported = this.prisma.$transaction(async (tx) => {
      const target = await resolveLedgerTarget(
        tx,
        userId,
        data.accountId,
        data.cardId,
      );
      if (!target) {
        throw new Error('Email import target account or card is invalid');
      }

      const created = await tx.finTransaction.create({
        data: {
          userId,
          accountId: target.accountId,
          cardId: target.cardId,
          type: data.type ?? 'DEBIT',
          amount: data.amounts.amount,
          ledgerAmount: data.amounts.ledgerAmount,
          amountBaseCurrency: data.amounts.amountBaseCurrency,
          currency: data.amounts.currency,
          ledgerCurrency: data.amounts.ledgerCurrency,
          exchangeRate: data.amounts.exchangeRate,
          merchant: data.merchant,
          merchantId: data.merchantId,
          description: data.description,
          notes: data.notes ?? null,
          transactionDate: data.transactionDate,
          status: data.status,
          source: 'EMAIL',
          importReference: data.importReference,
          externalReference: data.externalReference ?? undefined,
          possibleDuplicateOfId: data.possibleDuplicateOfId ?? undefined,
          categoryId: data.categoryId ?? undefined,
          transferGroupId: data.transferGroupId ?? undefined,
          aiMetadata: (data.aiMetadata as Prisma.InputJsonValue) ?? {},
        },
        include: {
          account: { select: { id: true, name: true } },
          card: { select: { id: true, name: true } },
        },
      });

      let budgetSnapshots: BudgetSpendSnapshot[] = [];
      if (statusAffectsLedger(data.status)) {
        await applyBalanceForTransaction(tx, {
          accountId: target.accountId,
          cardId: target.cardId,
          cardType: target.cardType,
          derivedAccountId: target.derivedAccountId,
          currency: data.amounts.ledgerCurrency,
          type: data.type ?? 'DEBIT',
          amount: data.amounts.ledgerAmount,
        });
        budgetSnapshots = await adjustBudgetSpent(tx, {
          userId,
          categoryId: data.categoryId,
          type: data.type ?? 'DEBIT',
          amountBaseCurrency: data.amounts.amountBaseCurrency,
          transactionDate: data.transactionDate,
        });
      }

      await enqueueTransactionEvent({
        tx,
        events: this.events,
        userId,
        eventName: transactionCreatedEventName(created.status),
        transactionId: created.id,
      });
      await this.thresholds?.processThresholds(userId, budgetSnapshots, tx);

      return created;
    });
    return imported.then(async (created) => {
      await this.subscriptionMatcher?.matchTransaction({
        userId,
        transactionId: created.id,
      });
      return created;
    });
  }

  async pairEmailTransferLegs(
    userId: string,
    debitId: string,
    creditId: string,
  ): Promise<CreateTransferResult | null> {
    return this.prisma.$transaction(async (tx) => {
      const debit = await tx.finTransaction.findFirst({
        where: { id: debitId, userId, type: 'DEBIT' },
        include: {
          account: { select: { id: true, name: true } },
          card: { select: { id: true, name: true } },
        },
      });
      const credit = await tx.finTransaction.findFirst({
        where: { id: creditId, userId, type: 'CREDIT' },
        include: {
          account: { select: { id: true, name: true } },
          card: { select: { id: true, name: true } },
        },
      });
      if (!debit || !credit) {
        return null;
      }

      const transferGroupId =
        debit.transferGroupId ?? credit.transferGroupId ?? randomUUID();

      await this.stripExpenseCategory(tx, userId, debit);
      await this.stripExpenseCategory(tx, userId, credit);

      const updatedDebit = await tx.finTransaction.update({
        where: { id: debit.id },
        data: { transferGroupId, categoryId: null },
        include: {
          account: { select: { id: true, name: true } },
          card: { select: { id: true, name: true } },
        },
      });
      const updatedCredit = await tx.finTransaction.update({
        where: { id: credit.id },
        data: { transferGroupId, categoryId: null },
        include: {
          account: { select: { id: true, name: true } },
          card: { select: { id: true, name: true } },
        },
      });

      await this.events.enqueue(
        {
          eventName: AppEvents.FINANCE_TRANSFER_CREATED,
          aggregateType: 'FinTransfer',
          aggregateId: transferGroupId,
          userId,
          payload: {
            transferGroupId,
            debitId: updatedDebit.id,
            creditId: updatedCredit.id,
            amount: Number(updatedDebit.amount),
          },
        },
        tx,
      );

      return {
        debit: updatedDebit,
        credit: updatedCredit,
        transferGroupId,
      };
    });
  }

  async addEmailTransferCounterpart(
    userId: string,
    existingId: string,
    counterpart: EmailTransferCounterpart,
  ): Promise<CreateTransferResult | null> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.finTransaction.findFirst({
        where: { id: existingId, userId },
        include: {
          account: { select: { id: true, name: true } },
          card: { select: { id: true, name: true } },
        },
      });
      if (!existing) {
        return null;
      }

      const target = await resolveLedgerTarget(
        tx,
        userId,
        counterpart.accountId,
        counterpart.cardId,
      );
      if (!target) {
        return null;
      }

      await this.stripExpenseCategory(tx, userId, existing);

      const transferGroupId = existing.transferGroupId ?? randomUUID();
      const counterpartType = existing.type === 'DEBIT' ? 'CREDIT' : 'DEBIT';

      const created = await tx.finTransaction.create({
        data: {
          userId,
          accountId: target.accountId,
          cardId: target.cardId,
          type: counterpartType,
          amount: counterpart.amounts.amount,
          ledgerAmount: counterpart.amounts.ledgerAmount,
          amountBaseCurrency: counterpart.amounts.amountBaseCurrency,
          currency: counterpart.amounts.currency,
          ledgerCurrency: counterpart.amounts.ledgerCurrency,
          exchangeRate: counterpart.amounts.exchangeRate,
          description: counterpart.description ?? existing.description,
          notes: counterpart.notes ?? existing.notes,
          source: 'EMAIL',
          status: counterpart.status,
          transferGroupId,
          transactionDate: existing.transactionDate,
          ...(counterpart.importReference
            ? { importReference: counterpart.importReference }
            : {}),
          ...(counterpart.aiMetadata
            ? { aiMetadata: counterpart.aiMetadata }
            : {}),
        },
        include: {
          account: { select: { id: true, name: true } },
          card: { select: { id: true, name: true } },
        },
      });

      const updatedExisting = await tx.finTransaction.update({
        where: { id: existing.id },
        data: { transferGroupId, categoryId: null },
        include: {
          account: { select: { id: true, name: true } },
          card: { select: { id: true, name: true } },
        },
      });

      if (statusAffectsLedger(counterpart.status)) {
        await applyBalanceForTransaction(tx, {
          accountId: target.accountId,
          cardId: target.cardId,
          cardType: target.cardType,
          derivedAccountId: target.derivedAccountId,
          currency: counterpart.amounts.ledgerCurrency,
          type: counterpartType,
          amount: counterpart.amounts.ledgerAmount,
        });
      }

      await enqueueTransactionEvent({
        tx,
        events: this.events,
        userId,
        eventName: transactionCreatedEventName(created.status),
        transactionId: created.id,
      });
      await this.events.enqueue(
        {
          eventName: AppEvents.FINANCE_TRANSFER_CREATED,
          aggregateType: 'FinTransfer',
          aggregateId: transferGroupId,
          userId,
          payload: {
            transferGroupId,
            debitId:
              updatedExisting.type === 'DEBIT'
                ? updatedExisting.id
                : created.id,
            creditId:
              updatedExisting.type === 'CREDIT'
                ? updatedExisting.id
                : created.id,
            amount: Number(updatedExisting.amount),
          },
        },
        tx,
      );

      const debit =
        updatedExisting.type === 'DEBIT' ? updatedExisting : created;
      const credit =
        updatedExisting.type === 'CREDIT' ? updatedExisting : created;
      return {
        debit: debit,
        credit: credit,
        transferGroupId,
      };
    });
  }

  private async stripExpenseCategory(
    tx: TxClient,
    userId: string,
    row: {
      categoryId: string | null;
      type: FinTransactionType;
      status: string;
      amountBaseCurrency?: { toString(): string } | number | null;
      amount: { toString(): string } | number;
      transactionDate: Date;
    },
  ) {
    if (!row.categoryId || row.status !== 'CONFIRMED') {
      return;
    }
    await adjustBudgetSpent(tx, {
      userId,
      categoryId: row.categoryId,
      type: row.type,
      amountBaseCurrency: Number(row.amountBaseCurrency ?? row.amount),
      transactionDate: row.transactionDate,
      direction: -1,
    });
  }
}
