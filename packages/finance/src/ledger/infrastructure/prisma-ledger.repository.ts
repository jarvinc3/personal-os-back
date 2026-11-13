import { FinanceEvents } from '../../contracts';
import { Inject, Injectable, Optional } from '@nestjs/common';
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
import type { StoredMovement } from '../../shared/domain/deletion-snapshot';
import type { ResolvedAmounts } from '../../shared/domain/money';
import type { TransactionLinkKind } from '../../shared/domain/transaction-links';
import type { IncomingCardPayment } from '../application/reconcile-card-payment-import';
import type {
  CreateCardPaymentCommand,
  CreateTransactionCommand,
  CreateTransferCommand,
  FinTxStatus,
  ImportFinancialTransactionCommand,
  ListTransactionsQuery,
  TransactionUpdateFields,
} from '../application/commands/ledger.commands';
import type {
  BalanceAdjustmentTarget,
  ImportedTransferCounterpart,
  LedgerRepositoryPort,
} from '../application/ports/ledger.repository.port';
import {
  adjustBudgetSpent,
  applyBalanceForTransaction,
} from './balance.helpers';
import { ledgerFields, loadCardContext } from './ledger-row-context';
import { enqueueTransactionEvent } from './ledger-transaction-events';
import { revertPlanningLinks } from './planning-link-reversal';
import { PrismaLedgerDeletionRepository } from './prisma-ledger-deletion.repository';
import { PrismaLedgerImportRepository } from './prisma-ledger-import.repository';
import { PrismaLedgerReadRepository } from './prisma-ledger-read.repository';
import { PrismaLedgerWriteRepository } from './prisma-ledger-write.repository';

@Injectable()
export class PrismaLedgerRepository implements LedgerRepositoryPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly read: PrismaLedgerReadRepository,
    @Inject(DOMAIN_EVENT_PUBLISHER)
    private readonly events: DomainEventPublisherPort,
    private readonly deletion: PrismaLedgerDeletionRepository,
    private readonly importRepository: PrismaLedgerImportRepository,
    private readonly write: PrismaLedgerWriteRepository,
    @Optional()
    @Inject(BUDGET_THRESHOLD_PORT)
    private readonly thresholds?: BudgetThresholdPort,
    @Optional()
    @Inject(SUBSCRIPTION_MATCHER)
    private readonly subscriptionMatcher?: SubscriptionMatcherPort,
  ) {}

  findTransactions(userId: string, query: ListTransactionsQuery) {
    return this.read.findTransactions(userId, query);
  }

  findTransactionById(id: string, userId: string) {
    return this.read.findTransactionById(id, userId);
  }

  findTransactionsByIds(userId: string, ids: readonly string[]) {
    return this.read.findTransactionsByIds(userId, ids);
  }

  findPlanningLinkKind(
    transactionId: string,
    userId: string,
  ): Promise<TransactionLinkKind | null> {
    return this.read.findPlanningLinkKind(transactionId, userId);
  }

  findAccountById(id: string, userId: string) {
    return this.read.findAccountById(id, userId);
  }

  findCardLedgerContext(id: string, userId: string) {
    return this.read.findCardLedgerContext(id, userId);
  }

  findSavingsGoalIdByAccount(userId: string, accountId: string) {
    return this.read.findSavingsGoalIdByAccount(userId, accountId);
  }

  findBalanceAdjustmentTarget(
    userId: string,
    input: { accountId?: string; cardId?: string; currency?: string },
  ): Promise<BalanceAdjustmentTarget | null> {
    return this.read.findBalanceAdjustmentTarget(userId, input);
  }

  findTransactionByImportReference(importReference: string, userId: string) {
    return this.read.findTransactionByImportReference(importReference, userId);
  }

  findTransactionsByTransferGroupId(transferGroupId: string, userId: string) {
    return this.read.findTransactionsByTransferGroupId(transferGroupId, userId);
  }

  findTransactionsByTransferGroupIds(
    userId: string,
    transferGroupIds: string[],
  ) {
    return this.read.findTransactionsByTransferGroupIds(
      userId,
      transferGroupIds,
    );
  }

  findCandidatesForReverse(
    userId: string,
    params: {
      amount: number;
      currency: string;
      merchant: string | null;
      aroundDate: Date;
      statuses?: FinTxStatus[];
    },
  ) {
    return this.read.findCandidatesForReverse(userId, params);
  }

  findReverseCandidatesByCard(
    userId: string,
    params: {
      amount: number;
      currency: string;
      cardId: string;
      accountId: string | null;
      from: Date;
      to: Date;
      statuses?: FinTxStatus[];
    },
  ) {
    return this.read.findReverseCandidatesByCard(userId, params);
  }

  findTransactionByExternalReference(userId: string, reference: string) {
    return this.read.findTransactionByExternalReference(userId, reference);
  }

  findTransactionsByExternalReference(userId: string, reference: string) {
    return this.read.findTransactionsByExternalReference(userId, reference);
  }

  findImportedTransactionByEmailMessageId(userId: string, messageId: string) {
    return this.read.findImportedTransactionByEmailMessageId(userId, messageId);
  }

  findLinkedRefundTotal(params: {
    userId: string;
    originalId: string;
    currency: string;
  }) {
    return this.read.findLinkedRefundTotal(params);
  }

  findPossibleDuplicate(
    userId: string,
    params: {
      accountId?: string | null;
      cardId?: string | null;
      amount: number;
      currency: string;
      type: 'DEBIT' | 'CREDIT';
      transactionDate: Date;
    },
  ) {
    return this.read.findPossibleDuplicate(userId, params);
  }

  findDedupeCandidate(
    userId: string,
    params: {
      externalReference: string | null;
      accountId?: string | null;
      cardId?: string | null;
      amount: number;
      currency: string;
      type: 'DEBIT' | 'CREDIT';
      merchant: string | null;
      transactionDate: Date;
    },
  ) {
    return this.read.findDedupeCandidate(userId, params);
  }

  findLatestCategoryIdByMerchant(userId: string, merchant: string) {
    return this.read.findLatestCategoryIdByMerchant(userId, merchant);
  }

  createTransaction(
    userId: string,
    command: CreateTransactionCommand,
    amounts: ResolvedAmounts,
    source: 'MANUAL' | 'EMAIL' | 'AI' = 'MANUAL',
    extras?: {
      importReference?: string;
      aiMetadata?: unknown;
      linkedTransactionId?: string;
      transferGroupId?: string;
    },
  ) {
    return this.write.createTransaction(
      userId,
      command,
      amounts,
      source,
      extras,
    );
  }

  createBalanceAdjustment(
    userId: string,
    input: {
      accountId?: string | null;
      cardId?: string | null;
      amounts: ResolvedAmounts;
    },
  ) {
    return this.write.createBalanceAdjustment(userId, input);
  }

  createTransfer(input: {
    userId: string;
    command: CreateTransferCommand;
    fromAmounts: ResolvedAmounts;
    toAmounts: ResolvedAmounts;
    feeAmounts?: ResolvedAmounts;
    estimated: boolean;
  }) {
    return this.write.createTransfer(input);
  }

  createCardPayment(input: {
    userId: string;
    command: CreateCardPaymentCommand;
    fromAmounts: ResolvedAmounts;
    toAmounts: ResolvedAmounts;
  }) {
    return this.write.createCardPayment(input);
  }

  createImportedCardPayment(input: {
    userId: string;
    command: CreateCardPaymentCommand;
    fromAmounts: ResolvedAmounts;
    toAmounts: ResolvedAmounts;
    incoming: IncomingCardPayment;
  }) {
    return this.write.createImportedCardPayment(input);
  }

  previewImportedCardPayment(input: {
    userId: string;
    incoming: IncomingCardPayment;
  }) {
    return this.write.previewImportedCardPayment(input);
  }

  findCardForPayment(userId: string, cardId: string) {
    return this.write.findCardForPayment(userId, cardId);
  }

  updateTransfer(input: {
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
  }) {
    return this.write.updateTransfer(input);
  }

  updateTransaction(
    userId: string,
    id: string,
    fields: TransactionUpdateFields,
  ) {
    return this.write.updateTransaction(userId, id, fields);
  }

  async clearPossibleDuplicate(userId: string, id: string): Promise<void> {
    await this.prisma.finTransaction.updateMany({
      where: { id, userId },
      data: { possibleDuplicateOfId: null },
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
        const ctx = await loadCardContext({ tx, userId, cardId: row.cardId });
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
        reversedIds.push(row.id);
      }
      if (reversedIds.length > 0) {
        await tx.finTransaction.updateMany({
          where: { id: { in: reversedIds } },
          data: { status: 'REVERSED' },
        });
        for (const transactionId of reversedIds) {
          await enqueueTransactionEvent({
            tx,
            events: this.events,
            userId,
            eventName: FinanceEvents.TRANSACTION_REVERSED,
            transactionId: transactionId,
          });
        }
      }
    });
  }

  unconfirmTransactionsByTransferGroupId(
    userId: string,
    transferGroupId: string,
  ) {
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
        const ctx = await loadCardContext({ tx, userId, cardId: row.cardId });
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
        const snaps = await adjustBudgetSpent(tx, {
          userId,
          categoryId: row.categoryId,
          type: row.type,
          amountBaseCurrency: Number(row.amountBaseCurrency),
          transactionDate: row.transactionDate,
          direction: -1,
        });
        budgetSnapshots.push(...snaps);
        unconfirmedIds.push(row.id);
      }
      if (unconfirmedIds.length > 0) {
        await tx.finTransaction.updateMany({
          where: { id: { in: unconfirmedIds } },
          data: { status: 'PENDING' },
        });
        for (const transactionId of unconfirmedIds) {
          await enqueueTransactionEvent({
            tx,
            events: this.events,
            userId,
            eventName: FinanceEvents.TRANSACTION_UPDATED,
            transactionId: transactionId,
          });
        }
      }
      return { count: unconfirmedIds.length, budgetSnapshots };
    });
  }

  deleteTransaction(userId: string, id: string) {
    return this.deletion.deleteTransaction(userId, id);
  }

  deleteTransactionsByTransferGroupId(userId: string, transferGroupId: string) {
    return this.deletion.deleteTransactionsByTransferGroupId(
      userId,
      transferGroupId,
    );
  }

  purgeLedgerForAccount(userId: string, accountId: string) {
    return this.deletion.purgeLedgerForAccount(userId, accountId);
  }

  purgeLedgerForCard(userId: string, cardId: string) {
    return this.deletion.purgeLedgerForCard(userId, cardId);
  }

  restoreLedgerTransactions(
    userId: string,
    movements: readonly StoredMovement[],
  ) {
    return this.deletion.restoreLedgerTransactions(userId, movements);
  }

  restoreTransaction(userId: string, id: string, now: Date) {
    return this.deletion.restoreTransaction(userId, id, now);
  }

  createImportedTransaction(
    userId: string,
    data: ImportFinancialTransactionCommand,
  ) {
    return this.importRepository.createImportedTransaction(userId, data);
  }

  pairImportedTransferLegs(userId: string, debitId: string, creditId: string) {
    return this.importRepository.pairImportedTransferLegs(
      userId,
      debitId,
      creditId,
    );
  }

  addImportedTransferCounterpart(
    userId: string,
    existingId: string,
    counterpart: ImportedTransferCounterpart,
  ) {
    return this.importRepository.addImportedTransferCounterpart(
      userId,
      existingId,
      counterpart,
    );
  }

  confirmTransaction(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.finTransaction.findFirst({
        where: { id, userId },
      });
      if (!existing) {
        return null;
      }
      if (existing.status === 'CONFIRMED') {
        const already = await tx.finTransaction.findFirst({
          where: { id, userId },
          include: {
            account: { select: { id: true, name: true } },
            card: { select: { id: true, name: true } },
          },
        });
        return already
          ? {
              transaction: already,
              budgetSnapshots: [] as BudgetSpendSnapshot[],
            }
          : null;
      }

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
      });
      const budgetSnapshots = await adjustBudgetSpent(tx, {
        userId,
        categoryId: existing.categoryId,
        type: existing.type,
        amountBaseCurrency: Number(existing.amountBaseCurrency),
        transactionDate: existing.transactionDate,
      });

      await tx.finTransaction.update({
        where: { id },
        data: { status: 'CONFIRMED' },
      });

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
  ) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.finTransaction.findMany({
        where: { userId, transferGroupId, status: 'PENDING' },
      });

      const budgetSnapshots: BudgetSpendSnapshot[] = [];
      const confirmedTransactionIds: string[] = [];

      for (const row of rows) {
        const ctx = await loadCardContext({ tx, userId, cardId: row.cardId });
        const ledger = ledgerFields(row);
        await applyBalanceForTransaction(tx, {
          accountId: row.accountId,
          cardId: row.cardId,
          cardType: ctx.cardType,
          derivedAccountId: ctx.derivedAccountId,
          currency: ledger.currency,
          type: row.type,
          amount: ledger.amount,
        });
        const snaps = await adjustBudgetSpent(tx, {
          userId,
          categoryId: row.categoryId,
          type: row.type,
          amountBaseCurrency: Number(row.amountBaseCurrency),
          transactionDate: row.transactionDate,
        });
        budgetSnapshots.push(...snaps);
        confirmedTransactionIds.push(row.id);
      }

      const result = await tx.finTransaction.updateMany({
        where: { userId, transferGroupId, status: 'PENDING' },
        data: { status: 'CONFIRMED' },
      });
      for (const transactionId of confirmedTransactionIds) {
        await enqueueTransactionEvent({
          tx,
          events: this.events,
          userId,
          eventName: FinanceEvents.TRANSACTION_CONFIRMED,
          transactionId: transactionId,
        });
      }

      await this.thresholds?.processThresholds(userId, budgetSnapshots, tx);
      return { count: result.count, budgetSnapshots };
    });
  }

  unconfirmTransaction(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.finTransaction.findFirst({
        where: { id, userId },
      });
      if (!existing) {
        return null;
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
        await tx.finTransaction.update({
          where: { id },
          data: { status: 'PENDING' },
        });
        await enqueueTransactionEvent({
          tx,
          events: this.events,
          userId,
          eventName: FinanceEvents.TRANSACTION_UPDATED,
          transactionId: id,
        });
      }

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

      return {
        transaction: updated,
        budgetSnapshots: [] as BudgetSpendSnapshot[],
      };
    });
  }

  reverseTransaction(userId: string, originalId: string, aiMetadata?: unknown) {
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
}
