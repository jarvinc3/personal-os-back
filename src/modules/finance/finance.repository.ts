import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { paginationArgs } from '../../core/pagination/pagination.dto';
import type { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import type { CreateAccountDto } from './dto/create-account.dto';
import type { UpdateAccountDto } from './dto/update-account.dto';
import type { CreateTransactionDto } from './dto/create-transaction.dto';

@Injectable()
export class FinanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAccountsByUser(userId: string) {
    return this.prisma.finAccount.findMany({
      where: { userId, isActive: true },
      orderBy: { name: 'asc' },
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
        name: dto.name,
        type: dto.type,
        institution: dto.institution,
        currency: dto.currency ?? 'DOP',
        color: dto.color,
      },
    });
  }

  updateAccount(id: string, userId: string, dto: UpdateAccountDto) {
    return this.prisma.finAccount.updateMany({
      where: { id, userId },
      data: {
        name: dto.name,
        institution: dto.institution,
        color: dto.color,
        isActive: dto.isActive,
      },
    }).then(async (result) => {
      if (result.count === 0) {
        return null;
      }
      return this.prisma.finAccount.findFirst({ where: { id, userId } });
    });
  }

  findTransactions(userId: string, query: ListTransactionsQueryDto) {
    const { skip, take } = paginationArgs(query);
    const where: Prisma.FinTransactionWhereInput = {
      userId,
      ...(query.accountId ? { accountId: query.accountId } : {}),
    };

    return this.prisma.$transaction([
      this.prisma.finTransaction.findMany({
        where,
        orderBy: { transactionDate: 'desc' },
        skip,
        take,
        include: { account: { select: { id: true, name: true } } },
      }),
      this.prisma.finTransaction.count({ where }),
    ]);
  }

  findTransactionById(id: string, userId: string) {
    return this.prisma.finTransaction.findFirst({
      where: { id, userId },
      include: { account: { select: { id: true, name: true } } },
    });
  }

  createTransaction(
    userId: string,
    dto: CreateTransactionDto,
    amountBaseCurrency: number,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const account = await tx.finAccount.findFirst({
        where: { id: dto.accountId, userId },
      });

      if (!account) {
        return null;
      }

      const signedAmount =
        dto.type === 'CREDIT' ? dto.amount : -Math.abs(dto.amount);

      const created = await tx.finTransaction.create({
        data: {
          userId,
          accountId: dto.accountId,
          type: dto.type,
          amount: dto.amount,
          amountBaseCurrency,
          currency: dto.currency ?? account.currency,
          merchant: dto.merchant,
          description: dto.description,
          categoryId: dto.categoryId,
          transactionDate: new Date(dto.transactionDate),
        },
        include: { account: { select: { id: true, name: true } } },
      });

      await tx.finAccount.update({
        where: { id: dto.accountId },
        data: {
          balance: {
            increment: signedAmount,
          },
        },
      });

      return created;
    });
  }
}
