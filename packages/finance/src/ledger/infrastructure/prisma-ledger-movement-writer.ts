import type { DomainEventPublisher } from '@personal-os/contracts';
import type { Prisma, PrismaService } from '@personal-os/database';
import type { BudgetThresholdPort } from '../../shared/application/budget-threshold.port';
import type { SubscriptionMatcherPort } from '../../shared/application/subscription-matcher.port';
import type { BudgetSpendSnapshot } from '../../shared/domain/budget-snapshot';
import { transactionCreatedEventName } from '../../shared/domain/mappers';
import type { ResolvedAmounts } from '../../shared/domain/money';
import { statusAffectsLedger } from '../../shared/domain/transaction-status';
import type {
  CreateTransactionCommand,
  FinTxStatus,
} from '../application/commands/ledger.commands';
import type { CreateTransactionInput } from '../application/ports/ledger-write.repository.port';
import type { CreateTransactionResult } from '../application/ports/ledger.repository.port';
import {
  adjustBudgetSpent,
  applyBalanceForTransaction,
  resolveLedgerTarget,
  type LedgerTarget,
} from './balance.helpers';
import { enqueueTransactionEvent } from './ledger-transaction-events';

type MovementWriterDeps = {
  prisma: PrismaService;
  events: DomainEventPublisher;
  thresholds?: BudgetThresholdPort;
  subscriptionMatcher?: SubscriptionMatcherPort;
};

/** Writes that create one movement: the movement itself and a balance adjustment. */
export class PrismaLedgerMovementWriter {
  constructor(private readonly deps: MovementWriterDeps) {}

  async createTransaction({
    userId,
    command,
    amounts,
    source = 'MANUAL',
    extras,
  }: CreateTransactionInput): Promise<CreateTransactionResult | null> {
    const createdTransaction = await this.deps.prisma.$transaction(
      async (tx) => {
        const target = await resolveLedgerTarget(
          tx,
          userId,
          command.accountId,
          command.cardId,
        );
        if (!target) {
          return null;
        }

        const status = command.status ?? 'CONFIRMED';
        const created = await tx.finTransaction.create({
          data: buildTransactionData({
            userId,
            target,
            command,
            amounts,
            source,
            status,
            extras,
          }),
          include: {
            account: { select: { id: true, name: true } },
            card: { select: { id: true, name: true } },
          },
        });

        const budgetSnapshots = await this.applyConfirmedEffect({
          tx,
          userId,
          target,
          command,
          amounts,
          status,
        });

        await enqueueTransactionEvent({
          tx,
          events: this.deps.events,
          userId,
          eventName: transactionCreatedEventName(created.status),
          transactionId: created.id,
          announce: command.announce,
        });
        await this.deps.thresholds?.processThresholds(
          userId,
          budgetSnapshots,
          tx,
        );

        return {
          transaction: created,
          budgetSnapshots,
        };
      },
    );
    if (createdTransaction) {
      await this.deps.subscriptionMatcher?.matchTransaction({
        userId,
        transactionId: createdTransaction.transaction.id,
      });
    }
    return createdTransaction;
  }

  createBalanceAdjustment(
    userId: string,
    input: {
      accountId?: string | null;
      cardId?: string | null;
      amounts: ResolvedAmounts;
      description?: string;
      transactionDate?: Date;
    },
  ): Promise<CreateTransactionResult | null> {
    return this.deps.prisma.$transaction(async (tx) => {
      const target = await resolveLedgerTarget(
        tx,
        userId,
        input.accountId,
        input.cardId,
      );
      if (!target) {
        return null;
      }

      const created = await tx.finTransaction.create({
        data: buildAdjustmentData({ userId, target, input }),
        include: {
          account: { select: { id: true, name: true } },
          card: { select: { id: true, name: true } },
        },
      });

      await applyBalanceForTransaction(tx, {
        accountId: target.accountId,
        cardId: target.cardId,
        cardType: target.cardType,
        derivedAccountId: target.derivedAccountId,
        currency: input.amounts.ledgerCurrency,
        type: 'ADJUSTMENT',
        amount: input.amounts.ledgerAmount,
      });

      await enqueueTransactionEvent({
        tx,
        events: this.deps.events,
        userId,
        eventName: transactionCreatedEventName(created.status),
        transactionId: created.id,
      });

      return {
        transaction: created,
        budgetSnapshots: [],
      };
    });
  }

  private async applyConfirmedEffect({
    tx,
    userId,
    target,
    command,
    amounts,
    status,
  }: {
    tx: Prisma.TransactionClient;
    userId: string;
    target: LedgerTarget;
    command: CreateTransactionCommand;
    amounts: ResolvedAmounts;
    status: FinTxStatus;
  }): Promise<BudgetSpendSnapshot[]> {
    if (!statusAffectsLedger(status)) {
      return [];
    }
    await applyBalanceForTransaction(tx, {
      accountId: target.accountId,
      cardId: target.cardId,
      cardType: target.cardType,
      derivedAccountId: target.derivedAccountId,
      currency: amounts.ledgerCurrency,
      type: command.type,
      amount: amounts.ledgerAmount,
    });
    return adjustBudgetSpent(tx, {
      userId,
      categoryId: command.categoryId,
      type: command.type,
      amountBaseCurrency: amounts.amountBaseCurrency,
      transactionDate: new Date(command.transactionDate),
    });
  }
}

function buildTransactionData({
  userId,
  target,
  command,
  amounts,
  source,
  status,
  extras,
}: {
  userId: string;
  target: LedgerTarget;
  command: CreateTransactionCommand;
  amounts: ResolvedAmounts;
  source: 'MANUAL' | 'EMAIL' | 'AI';
  status: FinTxStatus;
  extras?: CreateTransactionInput['extras'];
}): Prisma.FinTransactionUncheckedCreateInput {
  return {
    userId,
    accountId: target.accountId,
    cardId: target.cardId,
    type: command.type,
    amount: amounts.amount,
    ledgerAmount: amounts.ledgerAmount,
    amountBaseCurrency: amounts.amountBaseCurrency,
    currency: amounts.currency,
    ledgerCurrency: amounts.ledgerCurrency,
    exchangeRate: amounts.exchangeRate,
    merchant: command.merchant,
    merchantId: command.merchantId,
    description: command.description,
    categoryId: command.categoryId,
    notes: command.notes,
    source,
    status,
    transactionDate: new Date(command.transactionDate),
    ...(extras?.importReference
      ? { importReference: extras.importReference }
      : {}),
    ...(extras?.aiMetadata ? { aiMetadata: extras.aiMetadata } : {}),
    ...(extras?.linkedTransactionId
      ? { linkedTransactionId: extras.linkedTransactionId }
      : {}),
    ...(extras?.transferGroupId
      ? { transferGroupId: extras.transferGroupId }
      : {}),
  };
}

function buildAdjustmentData({
  userId,
  target,
  input,
}: {
  userId: string;
  target: LedgerTarget;
  input: {
    amounts: ResolvedAmounts;
    description?: string;
    transactionDate?: Date;
  };
}): Prisma.FinTransactionUncheckedCreateInput {
  return {
    userId,
    accountId: target.accountId,
    cardId: target.cardId,
    type: 'ADJUSTMENT',
    amount: input.amounts.amount,
    ledgerAmount: input.amounts.ledgerAmount,
    amountBaseCurrency: input.amounts.amountBaseCurrency,
    currency: input.amounts.currency,
    ledgerCurrency: input.amounts.ledgerCurrency,
    exchangeRate: input.amounts.exchangeRate,
    description: input.description ?? 'Reajuste de saldo',
    source: 'MANUAL',
    status: 'CONFIRMED',
    transactionDate: input.transactionDate ?? new Date(),
  };
}
