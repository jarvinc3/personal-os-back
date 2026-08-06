import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { paginationArgs } from '../../core/pagination/pagination.dto';
import type { Prisma } from '../../prisma/generated/client';
import { Prisma as PrismaNS } from '../../prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateAccountDto } from './dto/create-account.dto';
import type { CreateTransactionDto } from './dto/create-transaction.dto';
import type { CreateTransferDto } from './dto/create-transfer.dto';
import type { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import type { UpdateAccountDto } from './dto/update-account.dto';
import {
    adjustBudgetSpent,
    applyBalanceForTransaction,
    resolveLedgerTarget,
} from './lib/balance.helpers';
import { normalizeCurrencyCode } from './lib/finance-validation';

export type BudgetSpendSnapshot = {
  budgetId: string;
  amountSpent: number;
  amountLimit: number;
  alertThresholdPct: number;
};

export type CreateTransactionResult = {
  transaction: NonNullable<
    Awaited<ReturnType<FinanceRepository['findTransactionById']>>
  >;
  budgetSnapshots: BudgetSpendSnapshot[];
};

@Injectable()
export class FinanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAccountsByUser(userId: string) {
    return this.prisma.finAccount.findMany({
      where: { userId, isActive: true },
      orderBy: { name: 'asc' },
      include: { institutionRef: true },
    });
  }

  findAccountById(id: string, userId: string) {
    return this.prisma.finAccount.findFirst({
      where: { id, userId },
    });
  }

  createAccount(userId: string, dto: CreateAccountDto) {
    return this.prisma.finAccount.create({
      data: {
        userId,
        institutionId: dto.institutionId,
        name: dto.name,
        type: dto.type,
        institution: dto.institution,
        currency: dto.currency ?? 'DOP',
        color: dto.color,
      },
      include: { institutionRef: true },
    });
  }

  updateAccount(id: string, userId: string, dto: UpdateAccountDto) {
    return this.prisma.finAccount.updateMany({
      where: { id, userId },
      data: {
        institutionId: dto.institutionId,
        name: dto.name,
        type: dto.type,
        institution: dto.institution,
        currency: dto.currency,
        color: dto.color,
        isActive: dto.isActive,
      },
    }).then(async (result) => {
      if (result.count === 0) {
        return null;
      }
      return this.prisma.finAccount.findFirst({
        where: { id, userId },
        include: { institutionRef: true },
      });
    });
  }

  findTransactions(userId: string, query: ListTransactionsQueryDto) {
    const { skip, take } = paginationArgs(query);
    const where: Prisma.FinTransactionWhereInput = {
      userId,
      ...(query.transferGroupId ? { transferGroupId: query.transferGroupId } : {}),
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(query.cardId ? { cardId: query.cardId } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            transactionDate: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { merchant: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    return this.prisma.$transaction([
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
    ]);
  }

  findTransactionById(id: string, userId: string) {
    return this.prisma.finTransaction.findFirst({
      where: { id, userId },
      include: {
        account: { select: { id: true, name: true } },
        card: { select: { id: true, name: true } },
      },
    });
  }

  createTransaction(
    userId: string,
    dto: CreateTransactionDto,
    amountBaseCurrency: number,
    source: 'MANUAL' | 'EMAIL' | 'AI' = 'MANUAL',
  ): Promise<CreateTransactionResult | null> {
    return this.prisma.$transaction(async (tx) => {
      const target = await resolveLedgerTarget(
        tx,
        userId,
        dto.accountId,
        dto.cardId,
      );
      if (!target) {
        return null;
      }

      const status = dto.status ?? 'CONFIRMED';
      const currency =
        (typeof dto.currency === 'string'
          ? String(normalizeCurrencyCode(dto.currency))
          : null) ??
        target.currencyHint ??
        'DOP';

      const created = await tx.finTransaction.create({
        data: {
          userId,
          accountId: target.accountId,
          cardId: target.cardId,
          type: dto.type,
          amount: dto.amount,
          amountBaseCurrency,
          currency,
          merchant: dto.merchant,
          description: dto.description,
          categoryId: dto.categoryId,
          notes: dto.notes,
          source,
          status,
          transactionDate: new Date(dto.transactionDate),
        },
        include: {
          account: { select: { id: true, name: true } },
          card: { select: { id: true, name: true } },
        },
      });

      let budgetSnapshots: BudgetSpendSnapshot[] = [];

      if (status === 'CONFIRMED') {
        await applyBalanceForTransaction(tx, {
          accountId: target.accountId,
          cardId: target.cardId,
          cardType: target.cardType,
          derivedAccountId: target.derivedAccountId,
          currency,
          type: dto.type,
          amount: dto.amount,
        });
        budgetSnapshots = await adjustBudgetSpent(tx, {
          userId,
          categoryId: dto.categoryId,
          type: dto.type,
          amountBaseCurrency,
          transactionDate: new Date(dto.transactionDate),
        });
      }

      return { transaction: created, budgetSnapshots };
    });
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
    if (!card) {
      return { cardType: null, derivedAccountId: null };
    }
    return {
      cardType: card.type,
      derivedAccountId: card.type === 'DEBIT' ? card.accountId : null,
    };
  }

  createTransfer(
    userId: string,
    dto: CreateTransferDto,
    amountBaseCurrency: number,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const fromTarget = await resolveLedgerTarget(
        tx,
        userId,
        dto.fromAccountId,
        dto.fromCardId,
      );
      const toTarget = await resolveLedgerTarget(
        tx,
        userId,
        dto.toAccountId,
        dto.toCardId,
      );
      if (!fromTarget || !toTarget) return null;

      const fromKey = `${fromTarget.accountId ?? ''}:${fromTarget.cardId ?? ''}`;
      const toKey = `${toTarget.accountId ?? ''}:${toTarget.cardId ?? ''}`;
      if (fromKey === toKey) return null;

      const transferGroupId = randomUUID();
      const currency =
        (typeof dto.currency === 'string'
          ? String(normalizeCurrencyCode(dto.currency))
          : null) ??
        fromTarget.currencyHint ??
        toTarget.currencyHint ??
        'DOP';
      const status = dto.status ?? 'CONFIRMED';
      const transactionDate = new Date(dto.transactionDate);

      const createLeg = async (leg: {
        type: 'DEBIT' | 'CREDIT';
        target: typeof fromTarget;
      }) => {
        const created = await tx.finTransaction.create({
          data: {
            userId,
            accountId: leg.target.accountId,
            cardId: leg.target.cardId,
            type: leg.type,
            amount: dto.amount,
            amountBaseCurrency,
            currency,
            description: dto.description,
            notes: dto.notes,
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

        if (status === 'CONFIRMED') {
          await applyBalanceForTransaction(tx, {
            accountId: leg.target.accountId,
            cardId: leg.target.cardId,
            cardType: leg.target.cardType,
            derivedAccountId: leg.target.derivedAccountId,
            currency,
            type: leg.type,
            amount: dto.amount,
          });
        }

        return created;
      };

      const debit = await createLeg({ type: 'DEBIT', target: fromTarget });
      const credit = await createLeg({ type: 'CREDIT', target: toTarget });

      return { debit, credit, transferGroupId };
    });
  }

  findTransactionsByTransferGroupId(transferGroupId: string, userId: string) {
    return this.prisma.finTransaction.findMany({
      where: { transferGroupId, userId },
      include: {
        account: { select: { id: true, name: true } },
        card: { select: { id: true, name: true } },
      },
      orderBy: { type: 'asc' },
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
          await applyBalanceForTransaction(tx, {
            accountId: row.accountId,
            cardId: row.cardId,
            cardType: ctx.cardType,
            derivedAccountId: ctx.derivedAccountId,
            currency: row.currency,
            type: row.type,
            amount: Number(row.amount),
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

      return tx.finTransaction.deleteMany({
        where: { userId, transferGroupId, source: 'MANUAL' },
      });
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
        await applyBalanceForTransaction(tx, {
          accountId: row.accountId,
          cardId: row.cardId,
          cardType: ctx.cardType,
          derivedAccountId: ctx.derivedAccountId,
          currency: row.currency,
          type: row.type,
          amount: Number(row.amount),
        });
        const snaps = await adjustBudgetSpent(tx, {
          userId,
          categoryId: row.categoryId,
          type: row.type,
          amountBaseCurrency: Number(row.amountBaseCurrency),
          transactionDate: row.transactionDate,
        });
        budgetSnapshots.push(...snaps);
      }

      const result = await tx.finTransaction.updateMany({
        where: { userId, transferGroupId, status: 'PENDING' },
        data: { status: 'CONFIRMED' },
      });

      return { count: result.count, budgetSnapshots };
    });
  }

  async updateTransaction(
    userId: string,
    id: string,
    data: Prisma.FinTransactionUncheckedUpdateManyInput,
  ): Promise<CreateTransactionResult | null> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.finTransaction.findFirst({
        where: { id, userId },
      });
      if (!existing) return null;

      const nextAccountId =
        data.accountId !== undefined
          ? (data.accountId as string | null)
          : existing.accountId;
      const nextCardId =
        data.cardId !== undefined
          ? (data.cardId as string | null)
          : existing.cardId;

      const nextTarget = await resolveLedgerTarget(
        tx,
        userId,
        nextAccountId,
        nextCardId,
      );
      if (!nextTarget) return null;

      // Persist resolved XOR
      data.accountId = nextTarget.accountId;
      data.cardId = nextTarget.cardId;
      if (typeof data.currency === 'string') {
        data.currency = String(normalizeCurrencyCode(data.currency));
      }

      if (existing.status === 'CONFIRMED') {
        const prev = await this.loadCardContext(tx, userId, existing.cardId);
        await applyBalanceForTransaction(tx, {
          accountId: existing.accountId,
          cardId: existing.cardId,
          cardType: prev.cardType,
          derivedAccountId: prev.derivedAccountId,
          currency: existing.currency,
          type: existing.type,
          amount: Number(existing.amount),
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

      await tx.finTransaction.updateMany({
        where: { id, userId },
        data,
      });

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
        await applyBalanceForTransaction(tx, {
          accountId: updated.accountId,
          cardId: updated.cardId,
          cardType: nextTarget.cardType,
          derivedAccountId: nextTarget.derivedAccountId,
          currency: updated.currency,
          type: updated.type,
          amount: Number(updated.amount),
        });
        budgetSnapshots = await adjustBudgetSpent(tx, {
          userId,
          categoryId: updated.categoryId,
          type: updated.type,
          amountBaseCurrency: Number(updated.amountBaseCurrency),
          transactionDate: updated.transactionDate,
        });
      }

      return { transaction: updated, budgetSnapshots };
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
        await applyBalanceForTransaction(tx, {
          accountId: existing.accountId,
          cardId: existing.cardId,
          cardType: ctx.cardType,
          derivedAccountId: ctx.derivedAccountId,
          currency: existing.currency,
          type: existing.type,
          amount: Number(existing.amount),
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

      return tx.finTransaction.deleteMany({
        where: { id, userId, source: 'MANUAL' },
      });
    });
  }

  /** Confirm a single PENDING transaction and apply balances. */
  confirmTransaction(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.finTransaction.findFirst({
        where: { id, userId },
      });
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
          ? { transaction: already, budgetSnapshots: [] as BudgetSpendSnapshot[] }
          : null;
      }

      const ctx = await this.loadCardContext(tx, userId, existing.cardId);
      await applyBalanceForTransaction(tx, {
        accountId: existing.accountId,
        cardId: existing.cardId,
        cardType: ctx.cardType,
        derivedAccountId: ctx.derivedAccountId,
        currency: existing.currency,
        type: existing.type,
        amount: Number(existing.amount),
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
      return { transaction: updated, budgetSnapshots };
    });
  }

  listInstitutions(userId: string) {
    return this.prisma.finInstitution.findMany({
      where: { userId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  createInstitution(userId: string, data: Omit<Prisma.FinInstitutionUncheckedCreateInput, 'userId'>) {
    return this.prisma.finInstitution.create({ data: { ...data, userId } });
  }

  updateInstitution(userId: string, id: string, data: Prisma.FinInstitutionUpdateInput) {
    return this.prisma.finInstitution.updateMany({
      where: { userId, id },
      data,
    }).then(async (result) => {
      if (result.count === 0) return null;
      return this.prisma.finInstitution.findFirst({ where: { userId, id } });
    });
  }

  listCards(userId: string) {
    return this.prisma.finCard.findMany({
      where: { userId, isActive: true },
      include: {
        institution: true,
        account: { select: { id: true, name: true } },
        balances: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findCardById(userId: string, id: string) {
    return this.prisma.finCard.findFirst({
      where: { id, userId },
      include: {
        institution: true,
        account: { select: { id: true, name: true } },
        balances: true,
      },
    });
  }

  createCard(userId: string, data: Omit<Prisma.FinCardUncheckedCreateInput, 'userId'>) {
    const payload = { ...data };
    if (payload.type === 'CREDIT') {
      payload.accountId = null;
    }
    if (typeof payload.lastFour === 'string') {
      payload.lastFour = payload.lastFour.trim();
    }
    return this.prisma.finCard.create({
      data: { ...payload, userId },
      include: { institution: true, balances: true, account: { select: { id: true, name: true } } },
    });
  }

  updateCard(userId: string, id: string, data: Prisma.FinCardUpdateInput) {
    return this.prisma.finCard.updateMany({
      where: { id, userId },
      data,
    }).then(async (result) => {
      if (result.count === 0) return null;
      return this.findCardById(userId, id);
    });
  }

  upsertCardBalance(userId: string, cardId: string, currency: string, balance: number, creditLimit?: number) {
    return this.prisma.$transaction(async (tx) => {
      const card = await tx.finCard.findFirst({ where: { id: cardId, userId } });
      if (!card) return null;

      const normalizedCurrency = String(normalizeCurrencyCode(currency));
      const existing = await tx.finCardBalance.findFirst({
        where: { cardId, currency: normalizedCurrency },
      });
      if (existing) {
        return tx.finCardBalance.update({
          where: { id: existing.id },
          data: {
            balance,
            ...(creditLimit !== undefined ? { creditLimit } : {}),
          },
        });
      }
      return tx.finCardBalance.create({
        data: {
          cardId,
          currency: normalizedCurrency,
          balance,
          ...(creditLimit !== undefined ? { creditLimit } : {}),
        },
      });
    });
  }

  listCategories(userId: string) {
    return this.prisma.finCategory.findMany({
      where: { OR: [{ userId }, { isSystem: true }] },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
  }

  createCategory(userId: string, data: Prisma.FinCategoryUncheckedCreateInput) {
    return this.prisma.finCategory.create({
      data: { ...data, userId, isSystem: false },
    });
  }

  updateCategory(userId: string, id: string, data: Prisma.FinCategoryUpdateInput) {
    return this.prisma.finCategory.updateMany({
      where: { id, userId, isSystem: false },
      data,
    }).then(async (result) => {
      if (result.count === 0) return null;
      return this.prisma.finCategory.findFirst({ where: { id, userId } });
    });
  }

  deleteCategory(userId: string, id: string) {
    return this.prisma.finCategory.deleteMany({ where: { id, userId, isSystem: false } });
  }

  listBudgets(userId: string) {
    return this.prisma.finBudget.findMany({
      where: { userId },
      include: { category: true },
      orderBy: { periodStart: 'desc' },
    });
  }

  createBudget(userId: string, data: Omit<Prisma.FinBudgetUncheckedCreateInput, 'userId'>) {
    return this.prisma.finBudget.create({ data: { ...data, userId }, include: { category: true } });
  }

  updateBudget(userId: string, id: string, data: Prisma.FinBudgetUpdateInput) {
    return this.prisma.finBudget.updateMany({ where: { id, userId }, data }).then(async (result) => {
      if (result.count === 0) return null;
      return this.prisma.finBudget.findFirst({ where: { id, userId }, include: { category: true } });
    });
  }

  deleteBudget(userId: string, id: string) {
    return this.prisma.finBudget.deleteMany({ where: { id, userId } });
  }

  listSavingsGoals(userId: string) {
    return this.prisma.finSavingsGoal.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  createSavingsGoal(userId: string, data: Omit<Prisma.FinSavingsGoalUncheckedCreateInput, 'userId'>) {
    return this.prisma.finSavingsGoal.create({ data: { ...data, userId } });
  }

  updateSavingsGoal(userId: string, id: string, data: Prisma.FinSavingsGoalUpdateInput) {
    return this.prisma.finSavingsGoal.updateMany({ where: { id, userId }, data }).then(async (result) => {
      if (result.count === 0) return null;
      return this.prisma.finSavingsGoal.findFirst({ where: { id, userId } });
    });
  }

  deleteSavingsGoal(userId: string, id: string) {
    return this.prisma.finSavingsGoal.deleteMany({ where: { id, userId } });
  }

  listLoans(userId: string) {
    return this.prisma.finLoan.findMany({
      where: { userId, isActive: true },
      orderBy: { nextDueDate: 'asc' },
      include: { account: { select: { id: true, name: true } } },
    });
  }

  createLoan(userId: string, data: Omit<Prisma.FinLoanUncheckedCreateInput, 'userId'>) {
    return this.prisma.finLoan.create({ data: { ...data, userId } });
  }

  updateLoan(userId: string, id: string, data: Prisma.FinLoanUpdateInput) {
    return this.prisma.finLoan.updateMany({ where: { id, userId }, data }).then(async (result) => {
      if (result.count === 0) return null;
      return this.prisma.finLoan.findFirst({ where: { id, userId } });
    });
  }

  listReceivables(userId: string) {
    return this.prisma.finReceivable.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  createReceivable(userId: string, data: Omit<Prisma.FinReceivableUncheckedCreateInput, 'userId'>) {
    return this.prisma.finReceivable.create({ data: { ...data, userId } });
  }

  updateReceivable(userId: string, id: string, data: Prisma.FinReceivableUpdateInput) {
    return this.prisma.finReceivable.updateMany({ where: { id, userId }, data }).then(async (result) => {
      if (result.count === 0) return null;
      return this.prisma.finReceivable.findFirst({ where: { id, userId } });
    });
  }

  listEmailSources(userId: string) {
    return this.prisma.finEmailSource.findMany({
      where: { userId },
      include: { logs: { orderBy: { startedAt: 'desc' }, take: 5 } },
      orderBy: { createdAt: 'desc' },
    });
  }

  findEmailSource(userId: string, id: string) {
    return this.prisma.finEmailSource.findFirst({
      where: { userId, id },
      include: { logs: { orderBy: { startedAt: 'desc' }, take: 10 } },
    });
  }

  createEmailSource(userId: string, data: Omit<Prisma.FinEmailSourceUncheckedCreateInput, 'userId'>) {
    return this.prisma.finEmailSource.create({ data: { ...data, userId } });
  }

  updateEmailSource(userId: string, id: string, data: Prisma.FinEmailSourceUpdateInput) {
    return this.prisma.finEmailSource
      .updateMany({
        where: { userId, id },
        data,
      })
      .then(async (result) => {
        if (result.count === 0) return null;
        return this.prisma.finEmailSource.findFirst({
          where: { userId, id },
          include: { logs: { orderBy: { startedAt: 'desc' }, take: 5 } },
        });
      });
  }

  createEmailSyncLog(sourceId: string) {
    return this.prisma.finEmailSyncLog.create({
      data: {
        sourceId,
        startedAt: new Date(),
        status: 'RUNNING',
      },
    });
  }

  completeEmailSyncLog(
    id: string,
    data: { status: 'SUCCESS' | 'FAILED'; emailsScanned: number; transactionsNew: number; error?: string },
  ) {
    return this.prisma.finEmailSyncLog.update({
      where: { id },
      data: {
        status: data.status,
        emailsScanned: data.emailsScanned,
        transactionsNew: data.transactionsNew,
        completedAt: new Date(),
        error: data.error,
      },
    });
  }

  findEmailSourceForRefresh(sourceId: string) {
    return this.prisma.finEmailSource.findUnique({
      where: { id: sourceId },
      select: {
        id: true,
        userId: true,
        accessToken: true,
        refreshToken: true,
        tokenExpiresAt: true,
        bankDomain: true,
        accountId: true,
        cardId: true,
        lastMessageId: true,
        lastSyncedAt: true,
        isActive: true,
      },
    });
  }

  updateEmailSourceTokens(
    sourceId: string,
    data: {
      accessToken: string;
      refreshToken: string;
      tokenExpiresAt: Date;
      emailAddress?: string;
      accountId?: string | null;
      cardId?: string | null;
    },
  ) {
    return this.prisma.finEmailSource.update({
      where: { id: sourceId },
      data: {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        tokenExpiresAt: data.tokenExpiresAt,
        ...(data.emailAddress ? { emailAddress: data.emailAddress } : {}),
        ...(data.accountId !== undefined ? { accountId: data.accountId } : {}),
        ...(data.cardId !== undefined ? { cardId: data.cardId } : {}),
      },
    });
  }

  findEmailSourceByUserEmailAndDomain(userId: string, emailAddress: string, bankDomain: string) {
    return this.prisma.finEmailSource.findFirst({
      where: { userId, emailAddress, bankDomain },
    });
  }

  createEmailPendingTransaction(
    userId: string,
    data: {
      accountId?: string;
      cardId?: string;
      emailMessageId: string;
      amount: number;
      currency: string;
      merchant: string | null;
      description: string;
      transactionDate: Date;
      categoryId?: string | null;
      type?: 'DEBIT' | 'CREDIT';
    },
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

      return tx.finTransaction.create({
        data: {
          userId,
          accountId: target.accountId,
          cardId: target.cardId,
          type: data.type ?? 'DEBIT',
          amount: data.amount,
          amountBaseCurrency: data.amount,
          currency: String(normalizeCurrencyCode(data.currency) ?? data.currency),
          merchant: data.merchant,
          description: data.description,
          transactionDate: data.transactionDate,
          status: 'PENDING',
          source: 'EMAIL',
          emailMessageId: data.emailMessageId,
          categoryId: data.categoryId ?? undefined,
        },
        include: {
          account: { select: { id: true, name: true } },
          card: { select: { id: true, name: true } },
        },
      });
    });
  }

  findTransactionByEmailMessageId(emailMessageId: string) {
    return this.prisma.finTransaction.findUnique({ where: { emailMessageId } });
  }

  async getAnalyticsSummary(userId: string, from?: Date, to?: Date) {
    const dateFilter =
      from || to
        ? {
            transactionDate: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {};

    const [accounts, cardBalances, aggregates] = await this.prisma.$transaction([
      this.prisma.finAccount.findMany({ where: { userId, isActive: true } }),
      this.prisma.finCardBalance.findMany({
        where: { card: { userId, isActive: true } },
        include: { card: true },
      }),
      this.prisma.finTransaction.groupBy({
        by: ['type', 'status'],
        where: { userId, ...dateFilter },
        _sum: { amountBaseCurrency: true },
        _count: { _all: true },
        orderBy: { type: 'asc' },
      }),
    ]);

    return { accounts, cardBalances, aggregates };
  }

  async getSpendingByCategory(userId: string, from?: Date, to?: Date) {
    const where: Prisma.FinTransactionWhereInput = {
      userId,
      type: 'DEBIT',
      status: 'CONFIRMED',
      ...(from || to
        ? {
            transactionDate: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    };
    return this.prisma.finTransaction.groupBy({
      by: ['categoryId'],
      where,
      _sum: { amountBaseCurrency: true },
      orderBy: { _sum: { amountBaseCurrency: 'desc' } },
    });
  }

  async getSpendingOverTime(
    userId: string,
    from: Date | undefined,
    to: Date | undefined,
    granularity: 'day' | 'week' | 'month',
  ) {
    const trunc =
      granularity === 'month'
        ? 'month'
        : granularity === 'week'
          ? 'week'
          : 'day';

    const rows = await this.prisma.$queryRaw<
      Array<{ bucket: Date; type: string; total: number }>
    >`
      SELECT
        date_trunc(${PrismaNS.raw(`'${trunc}'`)}, "transaction_date") AS bucket,
        "type"::text AS type,
        SUM("amount_base_currency")::float AS total
      FROM "fin_transactions"
      WHERE "user_id" = ${userId}
        AND "status" = 'CONFIRMED'
        AND "type" IN ('DEBIT', 'CREDIT')
        ${from ? PrismaNS.sql`AND "transaction_date" >= ${from}` : PrismaNS.empty}
        ${to ? PrismaNS.sql`AND "transaction_date" <= ${to}` : PrismaNS.empty}
      GROUP BY 1, 2
      ORDER BY 1 ASC
    `;

    return rows.map((row) => ({
      bucket: new Date(row.bucket),
      type: row.type,
      total: Number(row.total) || 0,
    }));
  }

  listUserCategories(userId: string) {
    return this.prisma.finCategory.findMany({
      where: {
        OR: [{ userId }, { isSystem: true }],
      },
    });
  }
}
