import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppEvents } from '@personal-os/core';
import { paginationArgs } from '@personal-os/core';
import type { FinTransactionType, Prisma } from '@personal-os/database';
import { PrismaService } from '@personal-os/database';
import type { DomainEventPublisherPort } from '../../events/application/ports/domain-event-publisher.port';
import type { BudgetThresholdPort } from '../../shared/application/budget-threshold.port';
import {
  BUDGET_THRESHOLD_PORT,
  DOMAIN_EVENT_PUBLISHER,
} from '../../shared/application/tokens';
import type { BudgetSpendSnapshot } from '../../shared/domain/budget-snapshot';
import {
  notificationTransactionPayload,
  transactionCreatedEventName,
} from '../../shared/domain/mappers';
import { EMAIL_DUPLICATE_DATE_TOLERANCE_MS } from '../../shared/domain/email-dedupe';
import type { ResolvedAmounts } from '../../shared/domain/money';
import { normalizeCurrencyCode } from '../../shared/domain/money';
import { statusAffectsLedger } from '../../shared/domain/transaction-status';

const transactionNotificationInclude = {
  account: { select: { name: true } },
  card: { select: { name: true } },
  category: { select: { name: true, icon: true, color: true } },
} satisfies Prisma.FinTransactionInclude;

const transactionPartyInclude = {
  account: {
    select: {
      id: true,
      name: true,
      institutionRef: {
        select: {
          logoUrl: true,
          logoPath: true,
          customLogoPath: true,
        },
      },
    },
  },
  card: {
    select: {
      id: true,
      name: true,
      network: true,
      institution: {
        select: {
          logoUrl: true,
          logoPath: true,
          customLogoPath: true,
        },
      },
    },
  },
} satisfies Prisma.FinTransactionInclude;
import type {
  CreateTransactionCommand,
  CreateTransferCommand,
  FinTxStatus,
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
        include: transactionPartyInclude,
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
            include: transactionPartyInclude,
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
    if (!query.accountId && !query.cardId) {
      return [];
    }
    if (query.type === 'DEBIT' || query.type === 'CREDIT') {
      return [];
    }
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
      include: transactionPartyInclude,
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
      include: transactionPartyInclude,
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
      statuses?: FinTxStatus[];
    },
  ) {
    const from = new Date(params.aroundDate);
    from.setUTCDate(from.getUTCDate() - 14);
    const to = new Date(params.aroundDate);
    to.setUTCDate(to.getUTCDate() + 14);
    return this.prisma.finTransaction.findMany({
      where: {
        userId,
        status: { in: params.statuses ?? ['CONFIRMED'] },
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

  findTransactionByExternalReference(userId: string, reference: string) {
    return this.prisma.finTransaction.findFirst({
      where: { userId, externalReference: reference },
      orderBy: { transactionDate: 'desc' },
    }) as Promise<LedgerTransactionRow | null>;
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
    if (params.externalReference) {
      return this.prisma.finTransaction.findFirst({
        where: {
          userId,
          externalReference: params.externalReference,
          status: { in: ['PENDING', 'CONFIRMED'] },
        },
        orderBy: { transactionDate: 'desc' },
      }) as Promise<LedgerTransactionRow | null>;
    }
    const tolerance = EMAIL_DUPLICATE_DATE_TOLERANCE_MS;
    const from = new Date(params.transactionDate.getTime() - tolerance);
    const to = new Date(params.transactionDate.getTime() + tolerance);
    return this.prisma.finTransaction.findFirst({
      where: {
        userId,
        status: { in: ['PENDING', 'CONFIRMED'] },
        currency: params.currency,
        amount: params.amount,
        type: params.type,
        transactionDate: { gte: from, lte: to },
        ...(params.accountId ? { accountId: params.accountId } : {}),
        ...(params.cardId ? { cardId: params.cardId } : {}),
        ...(params.merchant
          ? { merchant: { equals: params.merchant, mode: 'insensitive' } }
          : {}),
      },
      orderBy: { transactionDate: 'desc' },
    }) as Promise<LedgerTransactionRow | null>;
  }

  async findLatestCategoryIdByMerchant(userId: string, merchant: string) {
    const trimmed = merchant.trim();
    if (!trimmed) {
      return null;
    }
    const row = await this.prisma.finTransaction.findFirst({
      where: {
        userId,
        status: 'CONFIRMED',
        categoryId: { not: null },
        merchant: { equals: trimmed, mode: 'insensitive' },
      },
      orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
      select: { categoryId: true },
    });
    return row?.categoryId ?? null;
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

      await this.enqueueTransactionEvent(
        tx,
        userId,
        transactionCreatedEventName(created.status),
        created.id,
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

      const createLeg = async (leg: {
        type: 'DEBIT' | 'CREDIT';
        target: typeof fromTarget;
        amounts: ResolvedAmounts;
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
            description: command.description,
            notes: command.notes,
            source,
            status,
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

        await this.enqueueTransactionEvent(
          tx,
          userId,
          transactionCreatedEventName(created.status),
          created.id,
        );
        return created as LedgerTransactionRow;
      };

      const debit = await createLeg({
        type: 'DEBIT',
        target: fromTarget,
        amounts: fromAmounts,
        emailMessageId: command.fromEmailMessageId,
      });
      const credit = await createLeg({
        type: 'CREDIT',
        target: toTarget,
        amounts: toAmounts,
        emailMessageId: command.toEmailMessageId,
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
      const existing = await tx.finTransaction.findFirst({
        where: { id, userId },
      });
      if (!existing) {
        return null;
      }

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
      if (!nextTarget) {
        return null;
      }

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

      await this.enqueueTransactionEvent(
        tx,
        userId,
        AppEvents.FINANCE_TRANSACTION_UPDATED,
        updated.id,
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
      if (!existing) {
        return { count: 0 };
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
      if (!updated) {
        return null;
      }

      await this.enqueueTransactionEvent(
        tx,
        userId,
        AppEvents.FINANCE_TRANSACTION_CONFIRMED,
        updated.id,
      );
      await this.enqueueTransactionEvent(
        tx,
        userId,
        AppEvents.FINANCE_TRANSACTION_UPDATED,
        updated.id,
      );
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
        confirmedTransactionIds.push(row.id);
      }

      const result = await tx.finTransaction.updateMany({
        where: { userId, transferGroupId, status: 'PENDING' },
        data: { status: 'CONFIRMED' },
      });
      for (const transactionId of confirmedTransactionIds) {
        await this.enqueueTransactionEvent(
          tx,
          userId,
          AppEvents.FINANCE_TRANSACTION_CONFIRMED,
          transactionId,
        );
      }

      await this.thresholds?.processThresholds(userId, budgetSnapshots, tx);
      return { count: result.count, budgetSnapshots };
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
          ...(aiMetadata ? { aiMetadata: aiMetadata } : {}),
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
          notes: data.notes ?? null,
          transactionDate: data.transactionDate,
          status: data.status,
          source: 'EMAIL',
          emailMessageId: data.emailMessageId,
          externalReference: data.externalReference ?? undefined,
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

      await this.enqueueTransactionEvent(
        tx,
        userId,
        transactionCreatedEventName(created.status),
        created.id,
      );
      await this.thresholds?.processThresholds(userId, budgetSnapshots, tx);

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
    counterpart: {
      accountId?: string;
      cardId?: string;
      amounts: ResolvedAmounts;
      description?: string | null;
      notes?: string | null;
      status: FinTxStatus;
      emailMessageId?: string;
      aiMetadata?: unknown;
    },
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
          ...(counterpart.emailMessageId
            ? { emailMessageId: counterpart.emailMessageId }
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

      await this.enqueueTransactionEvent(
        tx,
        userId,
        transactionCreatedEventName(created.status),
        created.id,
      );
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

  private async purgeInstrumentRows(
    tx: TxClient,
    userId: string,
    instrumentRows: Array<{
      id: string;
      accountId: string | null;
      cardId: string | null;
      type: FinTransactionType;
      status: string;
      source: string;
      amount: { toString(): string } | number;
      ledgerAmount?: { toString(): string } | number | null;
      ledgerCurrency?: string | null;
      amountBaseCurrency?: { toString(): string } | number | null;
      currency: string;
      categoryId: string | null;
      transactionDate: Date;
      transferGroupId: string | null;
    }>,
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
      return { count: 0 };
    }

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
          amountBaseCurrency: Number(row.amountBaseCurrency ?? row.amount),
          transactionDate: row.transactionDate,
          direction: -1,
        });
      }
    }

    for (const row of rows) {
      await this.enqueueTransactionDeleted(tx, userId, row);
    }

    return tx.finTransaction.deleteMany({
      where: { userId, id: { in: rows.map((row) => row.id) } },
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

  private async enqueueTransactionEvent(
    tx: TxClient,
    userId: string,
    eventName: string,
    transactionId: string,
  ) {
    const row = await tx.finTransaction.findFirst({
      where: { id: transactionId, userId },
      include: transactionNotificationInclude,
    });
    if (!row) {
      return;
    }

    await this.events.enqueue(
      {
        eventName,
        aggregateType: 'FinTransaction',
        aggregateId: transactionId,
        userId,
        payload: notificationTransactionPayload(row),
      },
      tx,
    );
  }

  private async loadCardContext(
    tx: {
      finCard: {
        findFirst: (args: {
          where: { id: string; userId: string };
        }) => Promise<{
          type: 'CREDIT' | 'DEBIT';
          accountId: string | null;
        } | null>;
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
    if (!card) {
      return { cardType: null, derivedAccountId: null };
    }
    return {
      cardType: card.type,
      derivedAccountId: card.type === 'DEBIT' ? card.accountId : null,
    };
  }
}
