import { Injectable } from '@nestjs/common';
import { PrismaService } from '@personal-os/database';

@Injectable()
export class BalanceSheetRepository {
  constructor(private readonly prisma: PrismaService) {}

  async loadPositions(userId: string) {
    const [institutions, accounts, cardBalances, loans] =
      await this.prisma.$transaction([
        this.prisma.finInstitution.findMany({
          where: { userId, isActive: true },
          select: { id: true },
        }),
        this.prisma.finAccount.findMany({
          where: { userId, isActive: true },
          select: {
            id: true,
            name: true,
            type: true,
            institutionId: true,
            currency: true,
            balance: true,
          },
        }),
        this.prisma.finCardBalance.findMany({
          where: { card: { userId, isActive: true, type: 'CREDIT' } },
          select: {
            currency: true,
            balance: true,
            creditLimit: true,
            card: {
              select: { id: true, name: true, institutionId: true },
            },
          },
        }),
        this.prisma.finLoan.findMany({
          where: { userId, isActive: true },
          select: {
            id: true,
            lenderName: true,
            institutionId: true,
            currency: true,
            currentBalance: true,
          },
        }),
      ]);

    return { institutions, accounts, cardBalances, loans };
  }

  loadCashAccounts(userId: string) {
    return this.prisma.finAccount.findMany({
      where: {
        userId,
        isActive: true,
        type: 'CASH',
        institutionRef: { type: 'cash', isSystem: true },
      },
      select: { id: true, name: true, currency: true, balance: true },
      orderBy: [{ currency: 'asc' }, { name: 'asc' }],
    });
  }

  loadReceivables(userId: string) {
    return this.prisma.finReceivable.findMany({
      where: {
        userId,
        status: { in: ['PENDING', 'PARTIAL'] },
      },
      select: {
        id: true,
        debtorName: true,
        description: true,
        amount: true,
        paidAmount: true,
        writtenOffAmount: true,
        currency: true,
        dueDate: true,
      },
      orderBy: [{ dueDate: 'asc' }, { debtorName: 'asc' }],
    });
  }

  loadOpenDrifts(userId: string) {
    return this.prisma.finBalanceDrift.findMany({
      where: { userId, resolvedAt: null },
      select: {
        accountId: true,
        cardId: true,
        currency: true,
        difference: true,
      },
    });
  }

  loadMonthReconciliations(userId: string, from: Date, to: Date) {
    return this.prisma.finReconciliation.findMany({
      where: {
        userId,
        asOfDate: { gte: from, lte: to },
      },
      select: { accountId: true, cardId: true, currency: true },
    });
  }

  async loadUserTimezone(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    return user?.timezone ?? null;
  }
}
