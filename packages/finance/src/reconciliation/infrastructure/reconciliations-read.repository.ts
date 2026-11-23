import { Injectable } from '@nestjs/common';
import { PrismaService } from '@personal-os/database';
import { normalizeCurrencyCode } from '../../shared/domain/money';
import {
  reconciliationInclude,
  type ListReconciliationsQuery,
  type ReconciliationProduct,
  type ReconciliationRow,
  type ReconciliationTarget,
} from './reconciliations-types';

/** Lecturas de la conciliación: producto, listados y ajustes del periodo. */
@Injectable()
export class ReconciliationsReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findTarget(
    userId: string,
    input: { accountId?: string; cardId?: string; currency?: string },
  ): Promise<ReconciliationTarget | null> {
    const hasAccount = Boolean(input.accountId);
    const hasCard = Boolean(input.cardId);
    if (hasAccount === hasCard) {
      return null;
    }
    if (input.accountId) {
      return this.findAccountTarget(userId, input.accountId);
    }
    if (!input.cardId || !input.currency) {
      return null;
    }
    return this.findCardTarget(userId, input.cardId, input.currency);
  }

  /** Money out of the product in the period, used for the DGII suggestion. */
  async sumOutgoing({
    userId,
    target,
    from,
    to,
  }: {
    userId: string;
    target: ReconciliationTarget;
    from: Date;
    to: Date;
  }): Promise<number> {
    const aggregate = await this.prisma.finTransaction.aggregate({
      where: {
        userId,
        type: 'DEBIT',
        status: 'CONFIRMED',
        ...(target.accountId
          ? { accountId: target.accountId }
          : { cardId: target.cardId }),
        ledgerCurrency: target.currency,
        transactionDate: { gte: from, lte: to },
      },
      _sum: { ledgerAmount: true },
    });
    return Math.abs(Number(aggregate._sum.ledgerAmount ?? 0));
  }

  findById(userId: string, id: string): Promise<ReconciliationRow | null> {
    return this.prisma.finReconciliation.findFirst({
      where: { id, userId },
      include: reconciliationInclude,
    });
  }

  list(
    userId: string,
    query: ListReconciliationsQuery,
  ): Promise<ReconciliationRow[]> {
    return this.prisma.finReconciliation.findMany({
      where: {
        userId,
        ...(query.accountId ? { accountId: query.accountId } : {}),
        ...(query.cardId ? { cardId: query.cardId } : {}),
        ...(query.cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(query.cursor.key) } },
                {
                  createdAt: new Date(query.cursor.key),
                  id: { lt: query.cursor.id },
                },
              ],
            }
          : {}),
      },
      include: reconciliationInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.take,
    });
  }

  async listProducts(userId: string): Promise<ReconciliationProduct[]> {
    const [accounts, cardBalances] = await Promise.all([
      this.prisma.finAccount.findMany({
        where: { userId, isActive: true },
        select: {
          id: true,
          name: true,
          currency: true,
          balance: true,
          institutionRef: { select: { name: true } },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.finCardBalance.findMany({
        where: { card: { userId, isActive: true, type: 'CREDIT' } },
        select: {
          currency: true,
          balance: true,
          card: {
            select: {
              id: true,
              name: true,
              institution: { select: { name: true } },
            },
          },
        },
      }),
    ]);

    return [
      ...accounts.map((account) => ({
        key: `account:${account.id}`,
        kind: 'account' as const,
        accountId: account.id,
        cardId: null,
        currency: account.currency,
        name: account.name,
        institutionName: account.institutionRef?.name ?? null,
        balance: Number(account.balance),
      })),
      ...cardBalances.map((balance) => ({
        key: `card:${balance.card.id}:${balance.currency}`,
        kind: 'card' as const,
        accountId: null,
        cardId: balance.card.id,
        currency: balance.currency,
        name: balance.card.name,
        institutionName: balance.card.institution?.name ?? null,
        balance: Number(balance.balance),
      })),
    ];
  }

  listBetween(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<
    Array<{
      id: string;
      accountId: string | null;
      cardId: string | null;
      currency: string;
      asOfDate: Date;
      realBalance: unknown;
      difference: unknown;
      createdAt: Date;
    }>
  > {
    return this.prisma.finReconciliation.findMany({
      where: { userId, asOfDate: { gte: from, lte: to } },
      select: {
        id: true,
        accountId: true,
        cardId: true,
        currency: true,
        asOfDate: true,
        realBalance: true,
        difference: true,
        createdAt: true,
      },
      orderBy: [{ asOfDate: 'desc' }, { createdAt: 'desc' }],
    });
  }

  listAdjustmentsBetween(userId: string, from: Date, to: Date) {
    return this.prisma.finReconciliationAdjustment.findMany({
      where: {
        reconciliation: {
          userId,
          asOfDate: { gte: from, lte: to },
        },
      },
      select: {
        kind: true,
        amount: true,
        reconciliation: {
          select: {
            asOfDate: true,
            account: {
              select: {
                institutionId: true,
                institutionRef: { select: { name: true } },
              },
            },
            card: {
              select: {
                institutionId: true,
                institution: { select: { name: true } },
              },
            },
          },
        },
      },
    });
  }

  private async findAccountTarget(
    userId: string,
    accountId: string,
  ): Promise<ReconciliationTarget | null> {
    const account = await this.prisma.finAccount.findFirst({
      where: { id: accountId, userId },
      select: {
        id: true,
        name: true,
        currency: true,
        balance: true,
        institutionRef: { select: { name: true } },
      },
    });
    if (!account) {
      return null;
    }
    return {
      accountId: account.id,
      cardId: null,
      cardType: null,
      derivedAccountId: null,
      currency: account.currency,
      name: account.name,
      institutionName: account.institutionRef?.name ?? null,
      currentBalance: Number(account.balance),
    };
  }

  /** Solo una tarjeta de crédito sin cuenta vinculada se concilia sola. */
  private async findCardTarget(
    userId: string,
    cardId: string,
    inputCurrency: string,
  ): Promise<ReconciliationTarget | null> {
    const card = await this.prisma.finCard.findFirst({
      where: { id: cardId, userId },
      select: {
        id: true,
        name: true,
        type: true,
        accountId: true,
        institution: { select: { name: true } },
      },
    });
    if (!card || card.type === 'DEBIT' || card.accountId) {
      return null;
    }
    const currency = normalizeCurrencyCode(inputCurrency);
    const balanceRow = await this.prisma.finCardBalance.findFirst({
      where: { cardId: card.id, currency },
      select: { balance: true },
    });
    return {
      accountId: null,
      cardId: card.id,
      cardType: card.type,
      derivedAccountId: null,
      currency,
      name: card.name,
      institutionName: card.institution?.name ?? null,
      currentBalance: balanceRow ? Number(balanceRow.balance) : 0,
    };
  }
}
