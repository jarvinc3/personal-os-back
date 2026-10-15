import { Injectable } from '@nestjs/common';
import type { CursorPoint } from '@personal-os/core';
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
  minimumSource: $Enums.FinAmountSource | null;
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

  async findCardOwnerId(cardId: string): Promise<string | null> {
    const row = await this.prisma.finCard.findUnique({
      where: { id: cardId },
      select: { userId: true },
    });
    return row?.userId ?? null;
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

  async listUserIdsWithActiveCreditCards(): Promise<string[]> {
    const rows = await this.prisma.finCard.findMany({
      where: { type: CREDIT_CARD_TYPE, isActive: true },
      select: { userId: true },
      distinct: ['userId'],
    });
    return rows.map((row) => row.userId);
  }

  listDueStatements(input: { userId: string; from: Date; to: Date }) {
    return this.prisma.finCardStatement.findMany({
      where: {
        card: { userId: input.userId, type: CREDIT_CARD_TYPE, isActive: true },
        dueDate: { not: null, gte: input.from, lte: input.to },
      },
      include: { card: { select: { id: true, name: true, lastFour: true } } },
      orderBy: { dueDate: 'asc' },
    });
  }

  listStatements(
    cardId: string,
    page: { cursor: CursorPoint | null; take: number },
  ) {
    return this.prisma.finCardStatement.findMany({
      where: {
        cardId,
        ...(page.cursor
          ? {
              OR: [
                { cycleEnd: { lt: new Date(page.cursor.key) } },
                {
                  cycleEnd: new Date(page.cursor.key),
                  id: { lt: page.cursor.id },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ cycleEnd: 'desc' }, { id: 'desc' }],
      take: page.take,
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

  async upsertStatement(snapshot: CardStatementSnapshotRow): Promise<string> {
    const { cardId, currency, cycleEnd, ...rest } = snapshot;
    const row = await this.prisma.finCardStatement.upsert({
      where: {
        cardId_currency_cycleEnd: { cardId, currency, cycleEnd },
      },
      create: { cardId, currency, cycleEnd, ...rest },
      update: rest,
    });
    return row.id;
  }

  /**
   * Timeline entry for a closed statement. Idempotent: re-syncing a card must
   * not add the same closing twice.
   */
  async recordStatementClosedEvent(input: {
    userId: string;
    cardId: string;
    statementId: string;
    currency: string;
    cycleEnd: Date;
    closingBalance: number;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.finInstrumentEvent.findFirst({
        where: {
          cardId: input.cardId,
          kind: 'STATEMENT_CLOSED',
          payload: { path: ['statementId'], equals: input.statementId },
        },
      });
      if (existing) {
        return;
      }
      await tx.finInstrumentEvent.create({
        data: {
          userId: input.userId,
          cardId: input.cardId,
          kind: 'STATEMENT_CLOSED',
          payload: {
            statementId: input.statementId,
            currency: input.currency,
            cycleEnd: input.cycleEnd.toISOString(),
            closingBalance: input.closingBalance,
          },
        },
      });
    });
  }
}
