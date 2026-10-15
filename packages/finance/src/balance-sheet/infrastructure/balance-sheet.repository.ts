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
            card: { select: { id: true, institutionId: true } },
          },
        }),
        this.prisma.finLoan.findMany({
          where: { userId, isActive: true },
          select: {
            id: true,
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
}
