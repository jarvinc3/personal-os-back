import { Injectable } from '@nestjs/common';
import { PrismaService } from '@personal-os/database';
import type { $Enums, Prisma } from '@personal-os/database';
import { CONFIRMED_TRANSACTION_STATUS } from '../domain/card-statement-amounts';

const CREDIT_CARD_TYPE = 'CREDIT' as const;

const CARD_MOVEMENT_SELECT = {
  id: true,
  type: true,
  status: true,
  amount: true,
  currency: true,
  ledgerAmount: true,
  ledgerCurrency: true,
  transactionDate: true,
  merchant: true,
  description: true,
  transferGroupId: true,
} satisfies Prisma.FinTransactionSelect;

const CREDIT_CARD_WITH_MOVEMENTS = {
  balances: {
    select: { currency: true, balance: true, creditLimit: true },
  },
  transactions: {
    where: { status: CONFIRMED_TRANSACTION_STATUS },
    select: CARD_MOVEMENT_SELECT,
    orderBy: { transactionDate: 'asc' as const },
  },
} satisfies Prisma.FinCardInclude;

export type CardStatementSnapshotRow = {
  cardId: string;
  currency: string;
  cycleStart: Date;
  cycleEnd: Date;
  dueDate: Date | null;
  closingBalance: number;
  minimumPayment: number;
  minimumSource: $Enums.FinAmountSource;
  status: $Enums.FinCardStatementStatus;
};

@Injectable()
export class CardStatementsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findCreditCard(cardId: string) {
    return this.prisma.finCard.findFirst({
      where: { id: cardId, type: CREDIT_CARD_TYPE },
      include: CREDIT_CARD_WITH_MOVEMENTS,
    });
  }

  listCreditCardsToSync() {
    return this.prisma.finCard.findMany({
      where: {
        type: CREDIT_CARD_TYPE,
        isActive: true,
        statementClosingDay: { not: null },
      },
      select: { id: true },
    });
  }

  listStatements(cardId: string) {
    return this.prisma.finCardStatement.findMany({
      where: { cardId },
      orderBy: { cycleEnd: 'desc' },
    });
  }

  findStatement(cardId: string, statementId: string) {
    return this.prisma.finCardStatement.findFirst({
      where: { id: statementId, cardId },
    });
  }

  updateStatement(
    statementId: string,
    data: {
      minimumPayment?: number;
      closingBalance?: number;
      dueDate?: Date | null;
    },
  ) {
    return this.prisma.finCardStatement.update({
      where: { id: statementId },
      data: {
        ...data,
        ...(data.minimumPayment !== undefined
          ? { minimumSource: 'MANUAL' as const }
          : {}),
      },
    });
  }

  async upsertStatement(snapshot: CardStatementSnapshotRow): Promise<void> {
    const { cardId, currency, cycleEnd, ...rest } = snapshot;
    await this.prisma.finCardStatement.upsert({
      where: {
        cardId_currency_cycleEnd: { cardId, currency, cycleEnd },
      },
      create: { cardId, currency, cycleEnd, ...rest },
      update: rest,
    });
  }
}
