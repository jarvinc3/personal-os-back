import {
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppEvents } from '@personal-os/core';
import { clampPageLimit, decodeCursor } from '@personal-os/core';
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
  DELETION_ENTITY,
  DELETION_MODEL,
  reversedMovements,
  toDeletionValues,
  type DeletionRow,
  type StoredMovement,
  type UpdatedRow,
} from '../../shared/domain/deletion-snapshot';
import { DeletionJournalRepository } from '../../shared/infrastructure/deletion-journal.repository';
import {
  notificationTransactionPayload,
  transactionCreatedEventName,
} from '../../shared/domain/mappers';
import { EMAIL_DUPLICATE_DATE_TOLERANCE_MS } from '../../shared/domain/email-dedupe';
import type { ResolvedAmounts } from '../../shared/domain/money';
import { normalizeCurrencyCode } from '../../shared/domain/money';
import { statusAffectsLedger } from '../../shared/domain/transaction-status';
import {
  TRANSACTION_LINK_KIND,
  type TransactionLinkKind,
} from '../../shared/domain/transaction-links';
import { shiftLoanDueDate } from '../../planning/domain/loan-installment-schedule';
import { applyReceivableBalance } from '../../planning/infrastructure/receivable-balance';
import { applySavingsGoalBalance } from '../../planning/infrastructure/savings-goal-balance';

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
  TransferStatus,
} from '../application/commands/ledger.commands';
import { TRANSFER_STATUS } from '../application/commands/ledger.commands';
import type {
  BalanceAdjustmentTarget,
  CreateTransactionResult,
  CreateTransferResult,
  LedgerRepositoryPort,
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
  restoreLedgerRows,
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
    private readonly journal: DeletionJournalRepository,
    @Optional()
    @Inject(BUDGET_THRESHOLD_PORT)
    private readonly thresholds?: BudgetThresholdPort,
  ) {}

  async findTransactions(userId: string, query: ListTransactionsQuery) {
    const limit = clampPageLimit(query.limit);
    const cursorPoint = query.cursor ? decodeCursor(query.cursor) : null;
    const matchingGroupIds = await this.findTransferGroupIdsForInstrument(
      userId,
      query,
    );
    const baseWhere = logicalTransactionsWhere(userId, query, matchingGroupIds);
    const cursorDate = cursorPoint ? new Date(cursorPoint.key) : null;
    const where: Prisma.FinTransactionWhereInput =
      cursorPoint && cursorDate
        ? {
            AND: [
              baseWhere,
              {
                OR: [
                  { transactionDate: { lt: cursorDate } },
                  { transactionDate: cursorDate, id: { lt: cursorPoint.id } },
                ],
              },
            ],
          }
        : baseWhere;
    const items = (await this.prisma.finTransaction.findMany({
      where,
      orderBy: [{ transactionDate: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: transactionPartyInclude,
    })) as LedgerTransactionRow[];

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

    return items.map((item) => ({
      ...item,
      transferCounterpart: item.transferGroupId
        ? (creditByGroup.get(item.transferGroupId) ?? null)
        : null,
    }));
  }

  private async findTransferGroupIdsForInstrument(
    userId: string,
    query: ListTransactionsQuery,
  ): Promise<string[]> {
    if (!query.accountId && !query.cardId) {
      return [];
    }
    if (
      query.type === 'DEBIT' ||
      query.type === 'CREDIT' ||
      query.type === 'ADJUSTMENT'
    ) {
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

  async findPlanningLinkKind(
    transactionId: string,
    userId: string,
  ): Promise<TransactionLinkKind | null> {
    const [installment, payment, contribution] = await Promise.all([
      this.prisma.finLoanInstallment.findFirst({
        where: { transactionId, loan: { userId } },
        select: { id: true },
      }),
      this.prisma.finReceivablePayment.findFirst({
        where: { transactionId, receivable: { userId } },
        select: { id: true },
      }),
      this.prisma.finSavingsGoalContribution.findFirst({
        where: { transactionId, goal: { userId } },
        select: { id: true },
      }),
    ]);
    if (installment) {
      return TRANSACTION_LINK_KIND.LOAN_INSTALLMENT;
    }
    if (payment) {
      return TRANSACTION_LINK_KIND.RECEIVABLE_PAYMENT;
    }
    if (contribution) {
      return TRANSACTION_LINK_KIND.SAVINGS_CONTRIBUTION;
    }
    return null;
  }

  findAccountById(id: string, userId: string) {
    return this.prisma.finAccount.findFirst({
      where: { id, userId },
      select: { id: true, currency: true },
    });
  }

  async findBalanceAdjustmentTarget(
    userId: string,
    input: { accountId?: string; cardId?: string; currency?: string },
  ): Promise<BalanceAdjustmentTarget | null> {
    const hasAccount = Boolean(input.accountId);
    const hasCard = Boolean(input.cardId);
    if (hasAccount === hasCard) {
      return null;
    }

    if (input.accountId) {
      const account = await this.prisma.finAccount.findFirst({
        where: { id: input.accountId, userId },
        select: { id: true, currency: true, balance: true },
      });
      if (!account) {
        return null;
      }
      return {
        accountId: account.id,
        cardId: null,
        currency: account.currency,
        currentBalance: Number(account.balance),
      };
    }

    if (!input.cardId || !input.currency) {
      return null;
    }

    const card = await this.prisma.finCard.findFirst({
      where: { id: input.cardId, userId },
      select: { id: true, type: true, accountId: true },
    });
    if (!card) {
      return null;
    }
    if (card.type === 'DEBIT' && !card.accountId) {
      return null;
    }
    if (card.type === 'CREDIT' && card.accountId) {
      return null;
    }

    const currency = normalizeCurrencyCode(input.currency);
    const balanceRow = await this.prisma.finCardBalance.findFirst({
      where: { cardId: card.id, currency },
      select: { balance: true },
    });
    return {
      accountId: null,
      cardId: card.id,
      currency,
      currentBalance: balanceRow ? Number(balanceRow.balance) : 0,
    };
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

  createBalanceAdjustment(
    userId: string,
    input: {
      accountId?: string | null;
      cardId?: string | null;
      amounts: ResolvedAmounts;
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
          description: 'Reajuste de saldo',
          source: 'MANUAL',
          status: 'CONFIRMED',
          transactionDate: new Date(),
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

      await this.enqueueTransactionEvent(
        tx,
        userId,
        transactionCreatedEventName(created.status),
        created.id,
      );

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
  }): Promise<CreateTransferResult | null> {
    const { userId, command, fromAmounts, toAmounts, feeAmounts } = input;
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
        }

        await this.enqueueTransactionEvent(
          tx,
          userId,
          transactionCreatedEventName(created.status),
          created.id,
        );
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

      return { debit, credit, ...(fee ? { fee } : {}), transferGroupId };
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
    transactionDate: Date;
    description?: string | null;
    notes?: string | null;
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
          ...sharedFields,
        },
      );
      if (!debit || !credit) {
        throw new NotFoundException('Transfer leg not found');
      }
      return { debit: debit.transaction, credit: credit.transaction };
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
          await this.enqueueTransactionEvent(
            tx,
            userId,
            AppEvents.FINANCE_TRANSACTION_UPDATED,
            transactionId,
          );
        }
      }
      return { count: unconfirmedIds.length, budgetSnapshots };
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

      const links = await this.snapshotPlanningLinks(tx, [existing.id]);
      await this.journal.record(tx, {
        userId,
        entityType: DELETION_ENTITY.transaction,
        entityId: id,
        snapshot: {
          rows: [
            {
              model: DELETION_MODEL.transaction,
              values: toDeletionValues(existing),
            },
            ...links.rows,
          ],
          updates: links.updates,
          ledgerReversed: [existing.id],
        },
      });

      await this.revertPlanningLinks(tx, [existing.id]);
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

      const links = await this.snapshotPlanningLinks(
        tx,
        rows.map((row) => row.id),
      );
      await this.journal.record(tx, {
        userId,
        entityType: DELETION_ENTITY.transaction,
        entityId: transferGroupId,
        snapshot: {
          rows: [
            ...rows.map((row) => ({
              model: DELETION_MODEL.transaction,
              values: toDeletionValues(row),
            })),
            ...links.rows,
          ],
          updates: links.updates,
          ledgerReversed: rows.map((row) => row.id),
        },
      });

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

      await this.revertPlanningLinks(
        tx,
        rows.map((row) => row.id),
      );
      for (const row of rows) {
        await this.enqueueTransactionDeleted(tx, userId, row);
      }

      return tx.finTransaction.deleteMany({
        where: { userId, transferGroupId, source: 'MANUAL' },
      });
    });
  }

  /**
   * A collected amount, a paid instalment and a savings contribution point at the
   * movement they created. Removing or reversing that movement takes its planning
   * effect with it, in the same transaction, so the two sides never disagree.
   */
  private async revertPlanningLinks(
    tx: Prisma.TransactionClient,
    transactionIds: readonly string[],
  ): Promise<void> {
    if (transactionIds.length === 0) {
      return;
    }
    await this.revertReceivablePayments(tx, transactionIds);
    await this.revertLoanInstallments(tx, transactionIds);
    await this.revertSavingsGoalContributions(tx, transactionIds);
  }

  private async revertReceivablePayments(
    tx: Prisma.TransactionClient,
    transactionIds: readonly string[],
  ): Promise<void> {
    const payments = await tx.finReceivablePayment.findMany({
      where: { transactionId: { in: [...transactionIds] } },
      select: { id: true, receivableId: true },
    });
    if (payments.length === 0) {
      return;
    }
    await tx.finReceivablePayment.deleteMany({
      where: { id: { in: payments.map((payment) => payment.id) } },
    });
    const receivableIds = [
      ...new Set(payments.map((payment) => payment.receivableId)),
    ];
    for (const receivableId of receivableIds) {
      await applyReceivableBalance(tx, receivableId);
    }
  }

  private async revertLoanInstallments(
    tx: Prisma.TransactionClient,
    transactionIds: readonly string[],
  ): Promise<void> {
    const installments = await tx.finLoanInstallment.findMany({
      where: { transactionId: { in: [...transactionIds] } },
      include: { loan: true },
    });
    if (installments.length === 0) {
      return;
    }
    await tx.finLoanInstallment.updateMany({
      where: { id: { in: installments.map((installment) => installment.id) } },
      data: { paidAt: null, transactionId: null },
    });
    for (const installment of installments) {
      const loan = installment.loan;
      await tx.finLoan.update({
        where: { id: loan.id },
        data: {
          paidInstallments: Math.max(0, loan.paidInstallments - 1),
          currentBalance:
            Number(loan.currentBalance) + Number(loan.installmentAmount),
          nextDueDate: shiftLoanDueDate(
            loan.nextDueDate,
            loan.installmentFreq,
            -1,
          ),
        },
      });
    }
  }

  private async revertSavingsGoalContributions(
    tx: Prisma.TransactionClient,
    transactionIds: readonly string[],
  ): Promise<void> {
    const contributions = await tx.finSavingsGoalContribution.findMany({
      where: { transactionId: { in: [...transactionIds] } },
      select: { id: true, goalId: true },
    });
    if (contributions.length === 0) {
      return;
    }
    await tx.finSavingsGoalContribution.deleteMany({
      where: { id: { in: contributions.map((item) => item.id) } },
    });
    const goalIds = [...new Set(contributions.map((item) => item.goalId))];
    const now = new Date();
    for (const goalId of goalIds) {
      await applySavingsGoalBalance(tx, goalId, now);
    }
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

  unconfirmTransaction(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.finTransaction.findFirst({
        where: { id, userId },
      });
      if (!existing) {
        return null;
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
        await tx.finTransaction.update({
          where: { id },
          data: { status: 'PENDING' },
        });
        await this.enqueueTransactionEvent(
          tx,
          userId,
          AppEvents.FINANCE_TRANSACTION_UPDATED,
          id,
        );
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

      await this.revertPlanningLinks(tx, [originalId]);

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
    instrumentRows: readonly LedgerTransactionRow[],
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
      return { count: 0, rows: [] };
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
          type: row.type as FinTransactionType,
          amount: ledger.amount,
          direction: -1,
        });
        await adjustBudgetSpent(tx, {
          userId,
          categoryId: row.categoryId,
          type: row.type as FinTransactionType,
          amountBaseCurrency: Number(row.amountBaseCurrency ?? row.amount),
          transactionDate: row.transactionDate,
          direction: -1,
        });
      }
    }

    for (const row of rows) {
      await this.enqueueTransactionDeleted(tx, userId, row);
    }

    await tx.finTransaction.deleteMany({
      where: { userId, id: { in: rows.map((row) => row.id) } },
    });
    return { count: rows.length, rows };
  }

  /** Applies again what `purgeInstrumentRows` and `deleteTransaction` reversed. */
  restoreLedgerTransactions(
    userId: string,
    movements: readonly StoredMovement[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      await restoreLedgerRows(tx, userId, movements);
      return { count: movements.length };
    });
  }

  restoreTransaction(userId: string, id: string, now: Date) {
    return this.journal.restore(
      userId,
      DELETION_ENTITY.transaction,
      id,
      now,
      (tx, snapshot) =>
        restoreLedgerRows(tx, userId, reversedMovements(snapshot)),
    );
  }

  /**
   * Rows the planning links touch before `revertPlanningLinks` runs: the ones
   * it deletes go in `rows`, the ones it changes in place go in `updates`.
   */
  private async snapshotPlanningLinks(
    tx: TxClient,
    transactionIds: readonly string[],
  ): Promise<{ rows: DeletionRow[]; updates: UpdatedRow[] }> {
    const ids = [...transactionIds];
    const payments = await tx.finReceivablePayment.findMany({
      where: { transactionId: { in: ids } },
    });
    const contributions = await tx.finSavingsGoalContribution.findMany({
      where: { transactionId: { in: ids } },
    });
    const installments = await tx.finLoanInstallment.findMany({
      where: { transactionId: { in: ids } },
    });
    const receivableIds = [
      ...new Set(payments.map((payment) => payment.receivableId)),
    ];
    const goalIds = [
      ...new Set(contributions.map((contribution) => contribution.goalId)),
    ];
    const loanIds = [
      ...new Set(installments.map((installment) => installment.loanId)),
    ];
    const receivables =
      receivableIds.length === 0
        ? []
        : await tx.finReceivable.findMany({
            where: { id: { in: receivableIds } },
          });
    const goals =
      goalIds.length === 0
        ? []
        : await tx.finSavingsGoal.findMany({ where: { id: { in: goalIds } } });
    const loans =
      loanIds.length === 0
        ? []
        : await tx.finLoan.findMany({ where: { id: { in: loanIds } } });

    return {
      rows: [
        ...payments.map((payment) => ({
          model: DELETION_MODEL.receivablePayment,
          values: toDeletionValues(payment),
        })),
        ...contributions.map((contribution) => ({
          model: DELETION_MODEL.savingsGoalContribution,
          values: toDeletionValues(contribution),
        })),
      ],
      updates: [
        ...receivables.map((receivable) => ({
          model: DELETION_MODEL.receivable,
          id: receivable.id,
          values: toDeletionValues(receivable),
        })),
        ...goals.map((goal) => ({
          model: DELETION_MODEL.savingsGoal,
          id: goal.id,
          values: toDeletionValues(goal),
        })),
        ...installments.map((installment) => ({
          model: DELETION_MODEL.loanInstallment,
          id: installment.id,
          values: toDeletionValues(installment),
        })),
        ...loans.map((loan) => ({
          model: DELETION_MODEL.loan,
          id: loan.id,
          values: toDeletionValues(loan),
        })),
      ],
    };
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
