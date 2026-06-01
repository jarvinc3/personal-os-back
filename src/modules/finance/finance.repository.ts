import { Injectable } from '@nestjs/common';
import { paginationArgs } from '../../core/pagination/pagination.dto';
import type { Prisma } from '../../prisma/generated/client';
import { format, startOfMonth, startOfWeek } from 'date-fns';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateAccountDto } from './dto/create-account.dto';
import type { CreateTransactionDto } from './dto/create-transaction.dto';
import type { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import type { UpdateAccountDto } from './dto/update-account.dto';

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
  ) {
    return this.prisma.$transaction(async (tx) => {
      if (!dto.accountId && !dto.cardId) {
        return null;
      }

      const account = dto.accountId
        ? await tx.finAccount.findFirst({
            where: { id: dto.accountId, userId },
          })
        : null;
      const card = dto.cardId
        ? await tx.finCard.findFirst({
            where: { id: dto.cardId, userId },
          })
        : null;

      if (dto.accountId && !account) {
        return null;
      }
      if (dto.cardId && !card) {
        return null;
      }

      const signedAmount =
        dto.type === 'CREDIT' ? dto.amount : -Math.abs(dto.amount);

      const created = await tx.finTransaction.create({
        data: {
          userId,
          accountId: dto.accountId,
          cardId: dto.cardId,
          type: dto.type,
          amount: dto.amount,
          amountBaseCurrency,
          currency: dto.currency ?? account?.currency ?? 'DOP',
          merchant: dto.merchant,
          description: dto.description,
          categoryId: dto.categoryId,
          notes: dto.notes,
          source,
          transactionDate: new Date(dto.transactionDate),
        },
        include: {
          account: { select: { id: true, name: true } },
          card: { select: { id: true, name: true } },
        },
      });

      if (dto.accountId) {
        await tx.finAccount.update({
          where: { id: dto.accountId },
          data: {
            balance: {
              increment: signedAmount,
            },
          },
        });
      }

      if (dto.cardId) {
        const balanceRow = await tx.finCardBalance.findFirst({
          where: { cardId: dto.cardId, currency: dto.currency ?? 'DOP' },
        });
        if (balanceRow) {
          await tx.finCardBalance.update({
            where: { id: balanceRow.id },
            data: {
              balance: { increment: signedAmount },
            },
          });
        } else {
          await tx.finCardBalance.create({
            data: {
              cardId: dto.cardId,
              currency: dto.currency ?? 'DOP',
              balance: signedAmount,
            },
          });
        }
      }

      return created;
    });
  }

  updateTransaction(
    userId: string,
    id: string,
    data: Prisma.FinTransactionUncheckedUpdateManyInput,
  ) {
    return this.prisma.finTransaction.updateMany({
      where: { id, userId },
      data,
    }).then(async (result) => {
      if (result.count === 0) return null;
      return this.findTransactionById(id, userId);
    });
  }

  deleteTransaction(userId: string, id: string) {
    return this.prisma.finTransaction.deleteMany({ where: { id, userId, source: 'MANUAL' } });
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
    return this.prisma.finCard.create({
      data: { ...data, userId },
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

      const existing = await tx.finCardBalance.findFirst({ where: { cardId, currency } });
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
        data: { cardId, currency, balance, ...(creditLimit !== undefined ? { creditLimit } : {}) },
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
      accountId: string;
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
    return this.prisma.finTransaction.create({
      data: {
        userId,
        accountId: data.accountId,
        type: data.type ?? 'DEBIT',
        amount: data.amount,
        amountBaseCurrency: data.amount,
        currency: data.currency,
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
    const [accounts, cardBalances, txs] = await this.prisma.$transaction([
      this.prisma.finAccount.findMany({ where: { userId, isActive: true } }),
      this.prisma.finCardBalance.findMany({
        where: { card: { userId, isActive: true } },
        include: { card: true },
      }),
      this.prisma.finTransaction.findMany({ where: { userId, ...dateFilter } }),
    ]);
    return { accounts, cardBalances, txs };
  }

  async getSpendingByCategory(userId: string, from?: Date, to?: Date) {
    const where: Prisma.FinTransactionWhereInput = {
      userId,
      type: 'DEBIT',
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
    type Row = { bucket: Date; type: string; total: number };

    const transactions = await this.prisma.finTransaction.findMany({
      where: {
        userId,
        status: 'CONFIRMED',
        type: { in: ['DEBIT', 'CREDIT'] },
        ...(from || to
          ? {
              transactionDate: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      select: {
        transactionDate: true,
        type: true,
        amountBaseCurrency: true,
      },
    });

    const bucketKey = (date: Date): string => {
      if (granularity === 'month') {
        return format(startOfMonth(date), 'yyyy-MM-dd');
      }
      if (granularity === 'week') {
        return format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd');
      }
      return format(date, 'yyyy-MM-dd');
    };

    const totalsByBucket = new Map<
      string,
      { expenses: number; income: number }
    >();

    for (const tx of transactions) {
      const key = bucketKey(tx.transactionDate);
      const entry = totalsByBucket.get(key) ?? { expenses: 0, income: 0 };
      const amount = Number(tx.amountBaseCurrency) || 0;
      if (tx.type === 'DEBIT') entry.expenses += amount;
      if (tx.type === 'CREDIT') entry.income += amount;
      totalsByBucket.set(key, entry);
    }

    const rows: Row[] = [];
    for (const [dateKey, totals] of totalsByBucket) {
      const bucket = new Date(`${dateKey}T00:00:00.000Z`);
      if (totals.expenses > 0) {
        rows.push({ bucket, type: 'DEBIT', total: totals.expenses });
      }
      if (totals.income > 0) {
        rows.push({ bucket, type: 'CREDIT', total: totals.income });
      }
    }

    return rows.sort((a, b) => a.bucket.getTime() - b.bucket.getTime());
  }

  listUserCategories(userId: string) {
    return this.prisma.finCategory.findMany({
      where: {
        OR: [{ userId }, { isSystem: true }],
      },
    });
  }
}
