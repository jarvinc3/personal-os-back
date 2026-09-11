import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppEvents } from '../../../../core/events/event.constants';
import { paginationArgs } from '../../../../core/pagination/pagination.dto';
import type { Prisma } from '../../../../prisma/generated/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import type { DomainEventPublisherPort } from '../../events/application/ports/domain-event-publisher.port';
import type { BudgetThresholdPort } from '../../shared/application/budget-threshold.port';
import {
    BUDGET_THRESHOLD_PORT,
    DOMAIN_EVENT_PUBLISHER,
} from '../../shared/application/tokens';
import type { BudgetSpendSnapshot } from '../../shared/domain/budget-snapshot';
import { transactionCreatedEventName } from '../../shared/domain/mappers';
import type { ResolvedAmounts } from '../../shared/domain/money';
import { normalizeCurrencyCode } from '../../shared/domain/money';
import { statusAffectsLedger } from '../../shared/domain/transaction-status';
import type {
    CreateTransactionCommand,
    CreateTransferCommand,
    ImportEmailTransactionCommand,
    ListTransactionsQuery,
    TransactionUpdateFields,
} from '../application/commands/ledger.commands';
import type {
    CreateTransactionResult,
    CreateTransferResult,
    LedgerRepositoryPort,
    LedgerTransactionRow,
} from '../application/ports/ledger.repository.port';
import {
    adjustBudgetSpent,
    applyBalanceForTransaction,
    resolveLedgerTarget,
} from './balance.helpers';
import { logicalTransactionsWhere } from './logical-transaction-query';

function ledgerFields(row: {
  amount: { toString(): string } | number;
  currency: string;
  ledgerAmount?: { toString(): string } | number | null;
  ledgerCurrency?: string | null;
}) {
  return {
    amount: Number(row.ledgerAmount ?? row.amount),
    currency: row.ledgerCurrency ?? row.currency,
  };
}

type TxClient = Prisma.TransactionClient;

@Injectable()
export class PrismaLedgerRepository implements LedgerRepositoryPort {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(DOMAIN_EVENT_PUBLISHER)
    private readonly events: DomainEventPublisherPort,
    @Optional()
    @Inject(BUDGET_THRESHOLD_PORT)
    private readonly thresholds?: BudgetThresholdPort,
  ) {}

  async findTransactions(userId: string, query: ListTransactionsQuery) {
    const { skip, take } = paginationArgs({
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });
    const matchingGroupIds = await this.findTransferGroupIdsForInstrument(
      userId,
      query,
    );
    const where = logicalTransactionsWhere(userId, query, matchingGroupIds);
    const [items, total] = (await this.prisma.$transaction([
      this.prisma.finTransaction.findMany({
        where,
        orderBy: { transactionDate: 'desc' },
        skip,
        take,
        include: {
          account: { select: { id: true, name: true } },
          card: { select: { id: true, name: true } },
        },
      }),
      this.prisma.finTransaction.count({ where }),
    ])) as [LedgerTransactionRow[], number];

    const groupIds = [
      ...new Set(
        items
          .map((item) => item.transferGroupId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const counterparts =
      groupIds.length === 0
        ? []
        : ((await this.prisma.finTransaction.findMany({
            where: {
              userId,
              transferGroupId: { in: groupIds },
              type: 'CREDIT',
            },
            include: {
              account: { select: { id: true, name: true } },
              card: { select: { id: true, name: true } },
            },
          })) as LedgerTransactionRow[]);
    const creditByGroup = new Map(
      counterparts.map((row) => [row.transferGroupId, row] as const),
    );

    const enriched = items.map((item) => ({
      ...item,
      transferCounterpart: item.transferGroupId
        ? (creditByGroup.get(item.transferGroupId) ?? null)
        : null,
    }));

    return [enriched, total] as [LedgerTransactionRow[], number];
  }

  private async findTransferGroupIdsForInstrument(
    userId: string,
    query: ListTransactionsQuery,
  ): Promise<string[]> {
    if (!query.accountId && !query.cardId) return [];
    if (query.type === 'DEBIT' || query.type === 'CREDIT') return [];
    const rows = await this.prisma.finTransaction.findMany({
      where: {
        userId,
        transferGroupId: { not: null },
        ...(query.accountId ? { accountId: query.accountId } : {}),
        ...(query.cardId ? { cardId: query.cardId } : {}),
      },
      select: { transferGroupId: true },
      distinct: ['transferGroupId'],
    });
    return rows
      .map((row) => row.transferGroupId)
      .filter((id): id is string => Boolean(id));
  }

  findTransactionById(id: string, userId: string) {
    return this.prisma.finTransaction.findFirst({
      where: { id, userId },
      include: {
        account: { select: { id: true, name: true } },
        card: { select: { id: true, name: true } },
      },
    }) as Promise<LedgerTransactionRow | null>;
  }

  findAccountById(id: string, userId: string) {
    return this.prisma.finAccount.findFirst({
      where: { id, userId },
      select: { id: true, currency: true },
    });
  }

  findTransactionByEmailMessageId(gmailMessageId: string, userId?: string) {
    return this.prisma.finTransaction.findFirst({
      where: {
        emailMessage: { gmailMessageId },
        ...(userId ? { userId } : {}),
      },
    }) as Promise<LedgerTransactionRow | null>;
  }

  findTransactionsByTransferGroupId(transferGroupId: string, userId: string) {
    return this.prisma.finTransaction.findMany({
      where: { transferGroupId, userId },
      include: {
        account: { select: { id: true, name: true } },
        card: { select: { id: true, name: true } },
      },
      orderBy: { type: 'asc' },
    }) as Promise<LedgerTransactionRow[]>;
  }

  findCandidatesForReverse(
    userId: string,
    params: {
      amount: number;
      currency: string;
      merchant: string | null;
      aroundDate: Date;
    },
  ) {
    const from = new Date(params.aroundDate);
    from.setUTCDate(from.getUTCDate() - 14);
    const to = new Date(params.aroundDate);
    to.setUTCDate(to.getUTCDate() + 14);
    return this.prisma.finTransaction.findMany({
      where: {
        userId,
        status: 'CONFIRMED',
        currency: params.currency,
        amount: params.amount,
        transactionDate: { gte: from, lte: to },
        ...(params.merchant
          ? { merchant: { contains: params.merchant, mode: 'insensitive' } }
          : {}),
      },
      orderBy: { transactionDate: 'desc' },
      take: 10,
    }) as Promise<LedgerTransactionRow[]>;
  }

  createTransaction(
    userId: string,
    command: CreateTransactionCommand,
    amounts: ResolvedAmounts,
    source: 'MANUAL' | 'EMAIL' | 'AI' = 'MANUAL',
    extras?: {
      emailMessageId?: string;
      aiMetadata?: unknown;
      linkedTransactionId?: string;
    },
  ): Promise<CreateTransactionResult | null> {
    return this.prisma.$transaction(async (tx) => {
      const target = await resolveLedgerTarget(
        tx,
        userId,
        command.accountId,
        command.cardId,
      );
      if (!target) return null;

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
          description: command.description,
          categoryId: command.categoryId,
          notes: command.notes,
          source,
          status,
          transactionDate: new Date(command.transactionDate),
          ...(extras?.emailMessageId
            ? { emailMessageId: extras.emailMessageId }
            : {}),
          ...(extras?.aiMetadata
            ? { aiMetadata: extras.aiMetadata }
            : {}),
          ...(extras?.linkedTransactionId
            ? { linkedTransactionId: extras.linkedTransactionId }
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

      await this.enqueueTransactionCreated(
        tx,
        userId,
        created.id,
        Number(created.amount),
        created.status,
        created.source,
      );
      await this.thresholds?.processThresholds(userId, budgetSnapshots, tx);

      return {
        transaction: created,
        budgetSnapshots,
      };
    });
  }

  createTransfer(
    userId: string,
    command: CreateTransferCommand,
    fromAmounts: ResolvedAmounts,
    toAmounts: ResolvedAmounts,
  ): Promise<CreateTransferResult | null> {
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
        command.toCardId,
      );
      if (!fromTarget || !toTarget) return null;

      const fromKey = `${fromTarget.accountId ?? ''}:${fromTarget.cardId ?? ''}`;
      const toKey = `${toTarget.accountId ?? ''}:${toTarget.cardId ?? ''}`;
      if (fromKey === toKey) return null;

      const transferGroupId = randomUUID();
      const status = command.status ?? 'CONFIRMED';
      const transactionDate = new Date(command.transactionDate);

      const createLeg = async (leg: {
        type: 'DEBIT' | 'CREDIT';
        target: typeof fromTarget;
        amounts: ResolvedAmounts;
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
            description: command.description,
            notes: command.notes,
            source: 'MANUAL',
            status,
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
            type: leg.type,
            amount: leg.amounts.ledgerAmount,
          });
        }

        await this.enqueueTransactionCreated(
          tx,
          userId,
          created.id,
          Number(created.amount),
          created.status,
          'MANUAL',
        );
        return created as LedgerTransactionRow;
      };

      const debit = await createLeg({
        type: 'DEBIT',
        target: fromTarget,
        amounts: fromAmounts,
      });
      const credit = await createLeg({
        type: 'CREDIT',
        target: toTarget,
        amounts: toAmounts,
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

  async updateTransaction(
    userId: string,
    id: string,
    fields: TransactionUpdateFields,
  ): Promise<CreateTransactionResult | null> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.finTransaction.findFirst({ where: { id, userId } });
      if (!existing) return null;

      const data: Prisma.FinTransactionUncheckedUpdateManyInput = {
        ...(fields.type !== undefined ? { type: fields.type } : {}),
        ...(fields.merchant !== undefined ? { merchant: fields.merchant } : {}),
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
      if (!nextTarget) return null;

      data.accountId = nextTarget.accountId;
      data.cardId = nextTarget.cardId;

      if (existing.status === 'CONFIRMED') {
        const prev = await this.loadCardContext(tx, userId, existing.cardId);
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
      if (!updated) return null;

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

      await this.events.enqueue(
        {
          eventName: AppEvents.FINANCE_TRANSACTION_UPDATED,
          aggregateType: 'FinTransaction',
          aggregateId: updated.id,
          userId,
          payload: {
            transactionId: updated.id,
            amount: Number(updated.amount),
            status: updated.status,
          },
        },
        tx,
      );
      await this.thresholds?.processThresholds(userId, budgetSnapshots, tx);

      return {
        transaction: updated,
        budgetSnapshots,
      };
    });
  }

  deleteTransaction(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.finTransaction.findFirst({
        where: { id, userId, source: 'MANUAL' },
      });
      if (!existing) return { count: 0 };

      if (existing.status === 'CONFIRMED') {
        const ctx = await this.loadCardContext(tx, userId, existing.cardId);
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
      if (rows.length === 0) return { count: 0 };

      for (const row of rows) {
        if (row.status === 'CONFIRMED') {
          const ctx = await this.loadCardContext(tx, userId, row.cardId);
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

      for (const row of rows) {
        await this.enqueueTransactionDeleted(tx, userId, row);
      }

      return tx.finTransaction.deleteMany({
        where: { userId, transferGroupId, source: 'MANUAL' },
      });
    });
  }

  confirmTransaction(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.finTransaction.findFirst({ where: { id, userId } });
      if (!existing) return null;
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

      const ctx = await this.loadCardContext(tx, userId, existing.cardId);
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
      if (!updated) return null;

      await this.events.enqueue(
        {
          eventName: AppEvents.FINANCE_TRANSACTION_CONFIRMED,
          aggregateType: 'FinTransaction',
          aggregateId: updated.id,
          userId,
          payload: {
            transactionId: updated.id,
            amount: Number(updated.amount),
            status: updated.status,
            source: updated.source,
          },
        },
        tx,
      );
      await this.events.enqueue(
        {
          eventName: AppEvents.FINANCE_TRANSACTION_UPDATED,
          aggregateType: 'FinTransaction',
          aggregateId: updated.id,
          userId,
          payload: {
            transactionId: updated.id,
            amount: Number(updated.amount),
            status: updated.status,
          },
        },
        tx,
      );
      await this.thresholds?.processThresholds(userId, budgetSnapshots, tx);

      return {
        transaction: updated,
        budgetSnapshots,
      };
    });
  }

  confirmTransactionsByTransferGroupId(userId: string, transferGroupId: string) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.finTransaction.findMany({
        where: { userId, transferGroupId, status: 'PENDING' },
      });

      const budgetSnapshots: BudgetSpendSnapshot[] = [];

      for (const row of rows) {
        const ctx = await this.loadCardContext(tx, userId, row.cardId);
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

        await this.events.enqueue(
          {
            eventName: AppEvents.FINANCE_TRANSACTION_CONFIRMED,
            aggregateType: 'FinTransaction',
            aggregateId: row.id,
            userId,
            payload: {
              transactionId: row.id,
              amount: Number(row.amount),
              status: 'CONFIRMED',
              source: row.source,
            },
          },
          tx,
        );
      }

      const result = await tx.finTransaction.updateMany({
        where: { userId, transferGroupId, status: 'PENDING' },
        data: { status: 'CONFIRMED' },
      });

      await this.thresholds?.processThresholds(userId, budgetSnapshots, tx);
      return { count: result.count, budgetSnapshots };
    });
  }

  reverseTransaction(
    userId: string,
    originalId: string,
    aiMetadata?: unknown,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.finTransaction.findFirst({
        where: { id: originalId, userId },
      });
      if (!existing) return null;
      if (existing.status === 'REVERSED') {
        return {
          transaction: existing,
          budgetSnapshots: [] as BudgetSpendSnapshot[],
        };
      }

      if (existing.status === 'CONFIRMED') {
        const ctx = await this.loadCardContext(tx, userId, existing.cardId);
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

      const updated = await tx.finTransaction.update({
        where: { id: originalId },
        data: {
          status: 'REVERSED',
          ...(aiMetadata
            ? { aiMetadata: aiMetadata }
            : {}),
        },
        include: {
          account: { select: { id: true, name: true } },
          card: { select: { id: true, name: true } },
        },
      });

      await this.events.enqueue(
        {
          eventName: AppEvents.FINANCE_TRANSACTION_REVERSED,
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

  createEmailImportTransaction(
    userId: string,
    data: ImportEmailTransactionCommand,
  ) {
    return this.prisma.$transaction(async (tx) => {
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
          description: data.description,
          transactionDate: data.transactionDate,
          status: data.status,
          source: 'EMAIL',
          emailMessageId: data.emailMessageId,
          categoryId: data.categoryId ?? undefined,
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

      await this.enqueueTransactionCreated(
        tx,
        userId,
        created.id,
        Number(created.amount),
        created.status,
        'EMAIL',
      );
      await this.thresholds?.processThresholds(userId, budgetSnapshots, tx);

      return created;
    });
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
        eventName: AppEvents.FINANCE_TRANSACTION_DELETED,
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

  private async enqueueTransactionCreated(
    tx: TxClient,
    userId: string,
    transactionId: string,
    amount: number,
    status: string,
    source: string,
  ) {
    await this.events.enqueue(
      {
        eventName: transactionCreatedEventName(status),
        aggregateType: 'FinTransaction',
        aggregateId: transactionId,
        userId,
        payload: { transactionId, amount, status, source },
      },
      tx,
    );
  }

  private async loadCardContext(
    tx: {
      finCard: {
        findFirst: (args: {
          where: { id: string; userId: string };
        }) => Promise<{ type: 'CREDIT' | 'DEBIT'; accountId: string | null } | null>;
      };
    },
    userId: string,
    cardId: string | null | undefined,
  ) {
    if (!cardId) {
      return {
        cardType: null as 'CREDIT' | 'DEBIT' | null,
        derivedAccountId: null as string | null,
      };
    }
    const card = await tx.finCard.findFirst({ where: { id: cardId, userId } });
    if (!card) return { cardType: null, derivedAccountId: null };
    return {
      cardType: card.type,
      derivedAccountId: card.type === 'DEBIT' ? card.accountId : null,
    };
  }
}
