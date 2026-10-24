import {
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppEvents } from '@personal-os/core';
import type { Prisma } from '@personal-os/database';
import { PrismaService } from '@personal-os/database';
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
import type { ResolvedAmounts } from '../../shared/domain/money';
import { normalizeCurrencyCode } from '../../shared/domain/money';
import { statusAffectsLedger } from '../../shared/domain/transaction-status';
import type {
  CreateCardPaymentCommand,
  CreateTransactionCommand,
  CreateTransferCommand,
  FinTxStatus,
  TransactionUpdateFields,
  TransferStatus,
} from '../application/commands/ledger.commands';
import { TRANSFER_STATUS } from '../application/commands/ledger.commands';
import type {
  CreateTransactionResult,
  CreateTransferResult,
  LedgerTransactionRow,
} from '../application/ports/ledger.repository.port';
import {
  OPERATION_LEG_ROLE,
  TRANSFER_FEE_CATEGORY_NAME,
  type OperationLegRole,
} from '../../shared/domain/transfer';
import {
  adjustBudgetSpent,
  applyBalanceForTransaction,
  resolveLedgerTarget,
  type LedgerTarget,
} from './balance.helpers';
import { ledgerFields, loadCardContext } from './ledger-row-context';
import { enqueueTransactionEvent } from './ledger-transaction-events';

/**
 * Writes that create or edit movements: the movement itself, an adjustment,
 * a transfer with its fee leg, a card payment and the edits that reapply their
 * balance and budget effect.
 */
@Injectable()
export class PrismaLedgerWriteRepository {
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

  async createTransaction(
    userId: string,
    command: CreateTransactionCommand,
    amounts: ResolvedAmounts,
    source: 'MANUAL' | 'EMAIL' | 'AI' = 'MANUAL',
    extras?: {
      emailMessageId?: string;
      aiMetadata?: unknown;
      linkedTransactionId?: string;
      transferGroupId?: string;
    },
  ): Promise<CreateTransactionResult | null> {
    const createdTransaction = await this.prisma.$transaction(async (tx) => {
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
        data: {
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
          ...(extras?.emailMessageId
            ? { emailMessageId: extras.emailMessageId }
            : {}),
          ...(extras?.aiMetadata ? { aiMetadata: extras.aiMetadata } : {}),
          ...(extras?.linkedTransactionId
            ? { linkedTransactionId: extras.linkedTransactionId }
            : {}),
          ...(extras?.transferGroupId
            ? { transferGroupId: extras.transferGroupId }
            : {}),
        },
        include: {
          account: { select: { id: true, name: true } },
          card: { select: { id: true, name: true } },
        },
      });

      let budgetSnapshots: BudgetSpendSnapshot[] = [];
      if (statusAffectsLedger(status)) {
        await applyBalanceForTransaction(tx, {
          accountId: target.accountId,
          cardId: target.cardId,
          cardType: target.cardType,
          derivedAccountId: target.derivedAccountId,
          currency: amounts.ledgerCurrency,
          type: command.type,
          amount: amounts.ledgerAmount,
        });
        budgetSnapshots = await adjustBudgetSpent(tx, {
          userId,
          categoryId: command.categoryId,
          type: command.type,
          amountBaseCurrency: amounts.amountBaseCurrency,
          transactionDate: new Date(command.transactionDate),
        });
      }

      await enqueueTransactionEvent({
        tx,
        events: this.events,
        userId,
        eventName: transactionCreatedEventName(created.status),
        transactionId: created.id,
        announce: command.announce,
      });
      await this.thresholds?.processThresholds(userId, budgetSnapshots, tx);

      return {
        transaction: created,
        budgetSnapshots,
      };
    });
    if (createdTransaction) {
      await this.subscriptionMatcher?.matchTransaction({
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
    return this.prisma.$transaction(async (tx) => {
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
        data: {
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
        },
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
        events: this.events,
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

  createTransfer(input: {
    userId: string;
    command: CreateTransferCommand;
    fromAmounts: ResolvedAmounts;
    toAmounts: ResolvedAmounts;
    feeAmounts?: ResolvedAmounts;
    estimated: boolean;
  }): Promise<CreateTransferResult | null> {
    const { userId, command, fromAmounts, toAmounts, feeAmounts, estimated } =
      input;
    return this.prisma.$transaction(async (tx) => {
      const fromTarget = await resolveLedgerTarget(
        tx,
        userId,
        command.fromAccountId,
        command.fromCardId,
      );
      const toTarget = await resolveLedgerTarget(
        tx,
        userId,
        command.toAccountId,
        undefined,
      );
      if (!fromTarget || !toTarget) {
        return null;
      }

      const fromKey = `${fromTarget.accountId ?? ''}:${fromTarget.cardId ?? ''}`;
      const toKey = `${toTarget.accountId ?? ''}:${toTarget.cardId ?? ''}`;
      if (fromKey === toKey) {
        return null;
      }

      const transferGroupId = randomUUID();
      const status = command.status ?? 'CONFIRMED';
      const transactionDate = new Date(command.transactionDate);
      const source = command.source ?? 'MANUAL';
      const budgetSnapshots: BudgetSpendSnapshot[] = [];

      const createLeg = async (leg: {
        type: 'DEBIT' | 'CREDIT';
        target: typeof fromTarget;
        amounts: ResolvedAmounts;
        legRole: OperationLegRole;
        legStatus: TransferStatus;
        categoryId?: string | null;
        emailMessageId?: string;
      }) => {
        const created = await tx.finTransaction.create({
          data: {
            userId,
            accountId: leg.target.accountId,
            cardId: leg.target.cardId,
            type: leg.type,
            amount: leg.amounts.amount,
            ledgerAmount: leg.amounts.ledgerAmount,
            amountBaseCurrency: leg.amounts.amountBaseCurrency,
            currency: leg.amounts.currency,
            ledgerCurrency: leg.amounts.ledgerCurrency,
            exchangeRate: leg.amounts.exchangeRate,
            isEstimated: estimated,
            categoryId: leg.categoryId ?? null,
            description: command.description,
            notes: command.notes,
            source,
            status: leg.legStatus,
            legRole: leg.legRole,
            rail: command.rail ?? null,
            transferGroupId,
            transactionDate,
            ...(leg.emailMessageId
              ? { emailMessageId: leg.emailMessageId }
              : {}),
            ...(command.aiMetadata ? { aiMetadata: command.aiMetadata } : {}),
          },
          include: {
            account: { select: { id: true, name: true } },
            card: { select: { id: true, name: true } },
          },
        });

        if (statusAffectsLedger(leg.legStatus)) {
          await applyBalanceForTransaction(tx, {
            accountId: leg.target.accountId,
            cardId: leg.target.cardId,
            cardType: leg.target.cardType,
            derivedAccountId: leg.target.derivedAccountId,
            currency: leg.amounts.ledgerCurrency,
            type: leg.type,
            amount: leg.amounts.ledgerAmount,
          });
          const snaps = await adjustBudgetSpent(tx, {
            userId,
            categoryId: leg.categoryId ?? null,
            type: leg.type,
            amountBaseCurrency: leg.amounts.amountBaseCurrency,
            transactionDate,
          });
          budgetSnapshots.push(...snaps);
        }

        await enqueueTransactionEvent({
          tx,
          events: this.events,
          userId,
          eventName: transactionCreatedEventName(created.status),
          transactionId: created.id,
          announce: command.announce,
        });
        return created as LedgerTransactionRow;
      };

      const destinationStatus: TransferStatus = command.destinationPending
        ? TRANSFER_STATUS.PENDING
        : status;
      const debit = await createLeg({
        type: 'DEBIT',
        target: fromTarget,
        amounts: fromAmounts,
        legRole: OPERATION_LEG_ROLE.SOURCE,
        legStatus: status,
        emailMessageId: command.fromEmailMessageId,
      });
      const credit = await createLeg({
        type: 'CREDIT',
        target: toTarget,
        amounts: toAmounts,
        legRole: OPERATION_LEG_ROLE.DESTINATION,
        legStatus: destinationStatus,
        emailMessageId: command.toEmailMessageId,
      });

      const fee =
        command.fee && feeAmounts
          ? await createLeg({
              type: 'DEBIT',
              target: fromTarget,
              amounts: feeAmounts,
              legRole: OPERATION_LEG_ROLE.FEE,
              legStatus: status,
              categoryId:
                command.fee.categoryId ?? (await this.resolveFeeCategoryId(tx)),
            })
          : undefined;

      await this.events.enqueue(
        {
          eventName: AppEvents.FINANCE_TRANSFER_CREATED,
          aggregateType: 'FinTransfer',
          aggregateId: transferGroupId,
          userId,
          payload: {
            transferGroupId,
            debitId: debit.id,
            creditId: credit.id,
            ...(fee ? { feeId: fee.id } : {}),
            amount: Number(debit.amount),
          },
        },
        tx,
      );

      await this.thresholds?.processThresholds(userId, budgetSnapshots, tx);

      return { debit, credit, ...(fee ? { fee } : {}), transferGroupId };
    });
  }

  createCardPayment(input: {
    userId: string;
    command: CreateCardPaymentCommand;
    fromAmounts: ResolvedAmounts;
    toAmounts: ResolvedAmounts;
  }): Promise<CreateTransferResult | null> {
    const { userId, command, fromAmounts, toAmounts } = input;
    return this.prisma.$transaction(async (tx) => {
      const fromTarget = await resolveLedgerTarget(
        tx,
        userId,
        command.fromAccountId,
        undefined,
      );
      const toTarget = await resolveLedgerTarget(
        tx,
        userId,
        undefined,
        command.cardId,
      );
      if (!fromTarget || !toTarget) {
        return null;
      }

      const transferGroupId = randomUUID();
      const status = command.status ?? 'CONFIRMED';
      const transactionDate = new Date(command.transactionDate);
      const source = command.source ?? 'MANUAL';

      const createLeg = async (leg: {
        target: LedgerTarget;
        amounts: ResolvedAmounts;
        legRole: OperationLegRole;
      }) => {
        const created = await tx.finTransaction.create({
          data: {
            userId,
            accountId: leg.target.accountId,
            cardId: leg.target.cardId,
            type: 'CARD_PAYMENT',
            amount: leg.amounts.amount,
            ledgerAmount: leg.amounts.ledgerAmount,
            amountBaseCurrency: leg.amounts.amountBaseCurrency,
            currency: leg.amounts.currency,
            ledgerCurrency: leg.amounts.ledgerCurrency,
            exchangeRate: leg.amounts.exchangeRate,
            description: command.description,
            notes: command.notes,
            source,
            status,
            legRole: leg.legRole,
            transferGroupId,
            transactionDate,
          },
          include: {
            account: { select: { id: true, name: true } },
            card: { select: { id: true, name: true } },
          },
        });

        if (statusAffectsLedger(status)) {
          await applyBalanceForTransaction(tx, {
            accountId: leg.target.accountId,
            cardId: leg.target.cardId,
            cardType: leg.target.cardType,
            derivedAccountId: leg.target.derivedAccountId,
            currency: leg.amounts.ledgerCurrency,
            type: 'CARD_PAYMENT',
            amount: leg.amounts.ledgerAmount,
          });
        }

        await enqueueTransactionEvent({
          tx,
          events: this.events,
          userId,
          eventName: transactionCreatedEventName(created.status),
          transactionId: created.id,
        });
        return created as LedgerTransactionRow;
      };

      const debit = await createLeg({
        target: fromTarget,
        amounts: fromAmounts,
        legRole: OPERATION_LEG_ROLE.SOURCE,
      });
      const credit = await createLeg({
        target: toTarget,
        amounts: toAmounts,
        legRole: OPERATION_LEG_ROLE.DESTINATION,
      });

      await this.events.enqueue(
        {
          eventName: AppEvents.FINANCE_TRANSFER_CREATED,
          aggregateType: 'FinTransfer',
          aggregateId: transferGroupId,
          userId,
          payload: {
            transferGroupId,
            debitId: debit.id,
            creditId: credit.id,
            amount: Number(debit.amount),
          },
        },
        tx,
      );

      return { debit, credit, transferGroupId };
    });
  }

  async findCardForPayment(userId: string, cardId: string) {
    const card = await this.prisma.finCard.findFirst({
      where: { id: cardId, userId },
      select: {
        id: true,
        type: true,
        balances: { select: { currency: true } },
      },
    });
    if (!card) {
      return null;
    }
    return {
      id: card.id,
      type: card.type,
      currencies: card.balances.map((balance) => balance.currency),
    };
  }

  private async upsertTransferFeeLeg(
    tx: Prisma.TransactionClient,
    input: {
      userId: string;
      transferGroupId: string | null;
      source: LedgerTransactionRow;
      feeAmounts: ResolvedAmounts;
      feeCategoryId?: string | null;
    },
  ): Promise<void> {
    if (!input.transferGroupId) {
      throw new NotFoundException('Grupo de transferencia no encontrado');
    }
    const amountFields = {
      amount: input.feeAmounts.amount,
      currency: input.feeAmounts.currency,
      ledgerAmount: input.feeAmounts.ledgerAmount,
      ledgerCurrency: input.feeAmounts.ledgerCurrency,
      amountBaseCurrency: input.feeAmounts.amountBaseCurrency,
      exchangeRate: input.feeAmounts.exchangeRate,
    };
    const existingFeeLeg = await tx.finTransaction.findFirst({
      where: {
        userId: input.userId,
        transferGroupId: input.transferGroupId,
        legRole: OPERATION_LEG_ROLE.FEE,
      },
      select: { id: true },
    });
    if (existingFeeLeg) {
      await tx.finTransaction.update({
        where: { id: existingFeeLeg.id },
        data: {
          ...amountFields,
          ...(input.feeCategoryId ? { categoryId: input.feeCategoryId } : {}),
        },
      });
      return;
    }
    await tx.finTransaction.create({
      data: {
        userId: input.userId,
        accountId: input.source.accountId,
        cardId: input.source.cardId,
        type: 'DEBIT',
        status: input.source.status as FinTxStatus,
        legRole: OPERATION_LEG_ROLE.FEE,
        transferGroupId: input.transferGroupId,
        transactionDate: input.source.transactionDate,
        categoryId:
          input.feeCategoryId ?? (await this.resolveFeeCategoryId(tx)),
        ...amountFields,
      },
    });
  }

  private async resolveFeeCategoryId(
    tx: Prisma.TransactionClient,
  ): Promise<string | null> {
    const category = await tx.finCategory.findFirst({
      where: {
        isSystem: true,
        name: TRANSFER_FEE_CATEGORY_NAME,
        type: 'EXPENSE',
      },
      select: { id: true },
    });
    return category?.id ?? null;
  }

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
    return this.prisma.$transaction(async (tx) => {
      const sharedFields = {
        transactionDate: input.transactionDate,
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      };
      const debit = await this.applyTransactionUpdate(
        tx,
        input.userId,
        input.debitId,
        {
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
      );
      const credit = await this.applyTransactionUpdate(
        tx,
        input.userId,
        input.creditId,
        {
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
      );
      if (!debit || !credit) {
        throw new NotFoundException(
          'Movimiento de la transferencia no encontrado',
        );
      }
      if (input.feeAmounts) {
        await this.upsertTransferFeeLeg(tx, {
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
    return this.prisma.$transaction((tx) =>
      this.applyTransactionUpdate(tx, userId, id, fields),
    );
  }

  private async applyTransactionUpdate(
    tx: Prisma.TransactionClient,
    userId: string,
    id: string,
    fields: TransactionUpdateFields,
  ): Promise<CreateTransactionResult | null> {
    const existing = await tx.finTransaction.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      return null;
    }

    const data: Prisma.FinTransactionUncheckedUpdateManyInput = {
      ...(fields.type !== undefined ? { type: fields.type } : {}),
      ...(fields.merchant !== undefined ? { merchant: fields.merchant } : {}),
      ...(fields.merchantId !== undefined
        ? { merchantId: fields.merchantId }
        : {}),
      ...(fields.description !== undefined
        ? { description: fields.description }
        : {}),
      ...(fields.notes !== undefined ? { notes: fields.notes } : {}),
      ...(fields.transactionDate !== undefined
        ? { transactionDate: fields.transactionDate }
        : {}),
      ...(fields.categoryId !== undefined
        ? { categoryId: fields.categoryId }
        : {}),
      ...(fields.status !== undefined ? { status: fields.status } : {}),
      ...(fields.amount !== undefined ? { amount: fields.amount } : {}),
      ...(fields.currency !== undefined
        ? { currency: normalizeCurrencyCode(fields.currency) }
        : {}),
      ...(fields.ledgerAmount !== undefined
        ? { ledgerAmount: fields.ledgerAmount }
        : {}),
      ...(fields.ledgerCurrency !== undefined
        ? { ledgerCurrency: fields.ledgerCurrency }
        : {}),
      ...(fields.amountBaseCurrency !== undefined
        ? { amountBaseCurrency: fields.amountBaseCurrency }
        : {}),
      ...(fields.exchangeRate !== undefined
        ? { exchangeRate: fields.exchangeRate }
        : {}),
      ...(fields.isEstimated !== undefined
        ? { isEstimated: fields.isEstimated }
        : {}),
    };

    const nextAccountId =
      fields.accountId !== undefined ? fields.accountId : existing.accountId;
    const nextCardId =
      fields.cardId !== undefined ? fields.cardId : existing.cardId;

    const nextTarget = await resolveLedgerTarget(
      tx,
      userId,
      nextAccountId,
      nextCardId,
    );
    if (!nextTarget) {
      return null;
    }

    data.accountId = nextTarget.accountId;
    data.cardId = nextTarget.cardId;

    if (existing.status === 'CONFIRMED') {
      const prev = await loadCardContext({
        tx,
        userId,
        cardId: existing.cardId,
      });
      const prevLedger = ledgerFields(existing);
      await applyBalanceForTransaction(tx, {
        accountId: existing.accountId,
        cardId: existing.cardId,
        cardType: prev.cardType,
        derivedAccountId: prev.derivedAccountId,
        currency: prevLedger.currency,
        type: existing.type,
        amount: prevLedger.amount,
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

    await tx.finTransaction.updateMany({ where: { id, userId }, data });

    const updated = await tx.finTransaction.findFirst({
      where: { id, userId },
      include: {
        account: { select: { id: true, name: true } },
        card: { select: { id: true, name: true } },
      },
    });
    if (!updated) {
      return null;
    }

    let budgetSnapshots: BudgetSpendSnapshot[] = [];
    if (updated.status === 'CONFIRMED') {
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
      budgetSnapshots = await adjustBudgetSpent(tx, {
        userId,
        categoryId: updated.categoryId,
        type: updated.type,
        amountBaseCurrency: Number(updated.amountBaseCurrency),
        transactionDate: updated.transactionDate,
      });
    }

    await enqueueTransactionEvent({
      tx,
      events: this.events,
      userId,
      eventName: AppEvents.FINANCE_TRANSACTION_UPDATED,
      transactionId: updated.id,
    });
    await this.thresholds?.processThresholds(userId, budgetSnapshots, tx);

    return {
      transaction: updated,
      budgetSnapshots,
    };
  }
}
