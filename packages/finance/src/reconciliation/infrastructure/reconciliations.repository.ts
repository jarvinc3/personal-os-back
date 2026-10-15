import { Injectable } from '@nestjs/common';
import type { Prisma } from '@personal-os/database';
import { PrismaService } from '@personal-os/database';
import type { CursorPoint } from '@personal-os/core';
import type { ResolvedAmounts } from '../../shared/domain/money';
import { normalizeCurrencyCode } from '../../shared/domain/money';
import {
  DELETION_ENTITY,
  DELETION_MODEL,
  reversedMovements,
  toDeletionValues,
} from '../../shared/domain/deletion-snapshot';
import { DeletionJournalRepository } from '../../shared/infrastructure/deletion-journal.repository';
import {
  applyBalanceForTransaction,
  resolveLedgerTarget,
  restoreLedgerRows,
} from '../../ledger/infrastructure/balance.helpers';
import {
  SYSTEM_KIND_BY_ADJUSTMENT_KIND,
  type ReconciliationAdjustmentKind,
} from '../domain/reconciliation-adjustment';

export type ReconciliationTarget = {
  accountId: string | null;
  cardId: string | null;
  cardType: 'CREDIT' | 'DEBIT' | null;
  derivedAccountId: string | null;
  currency: string;
  name: string;
  institutionName: string | null;
  currentBalance: number;
};

export type ResolvedAdjustmentInput = {
  kind: ReconciliationAdjustmentKind;
  amounts: ResolvedAmounts;
};

export type CreateReconciliationInput = {
  target: ReconciliationTarget;
  asOfDate: Date;
  appBalance: number;
  realBalance: number;
  difference: number;
  note: string | null;
  adjustments: ResolvedAdjustmentInput[];
};

export type ReconciliationRow = {
  id: string;
  userId: string;
  accountId: string | null;
  cardId: string | null;
  currency: string;
  asOfDate: Date;
  appBalance: unknown;
  realBalance: unknown;
  difference: unknown;
  note: string | null;
  createdAt: Date;
  adjustments: Array<{
    id: string;
    kind: ReconciliationAdjustmentKind;
    amount: unknown;
    transactionId: string;
  }>;
};

export type ReconciliationProduct = {
  key: string;
  kind: 'account' | 'card';
  accountId: string | null;
  cardId: string | null;
  currency: string;
  name: string;
  institutionName: string | null;
  balance: number;
};

export type ListReconciliationsQuery = {
  accountId?: string;
  cardId?: string;
  cursor: CursorPoint | null;
  take: number;
};

const ADJUSTMENT_DESCRIPTION = 'Ajuste de conciliación';

const reconciliationInclude = {
  adjustments: {
    select: { id: true, kind: true, amount: true, transactionId: true },
    orderBy: { id: 'asc' as const },
  },
} satisfies Prisma.FinReconciliationInclude;

@Injectable()
export class ReconciliationsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: DeletionJournalRepository,
  ) {}

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
      const account = await this.prisma.finAccount.findFirst({
        where: { id: input.accountId, userId },
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

    if (!input.cardId || !input.currency) {
      return null;
    }

    const card = await this.prisma.finCard.findFirst({
      where: { id: input.cardId, userId },
      select: {
        id: true,
        name: true,
        type: true,
        accountId: true,
        institution: { select: { name: true } },
      },
    });
    if (!card) {
      return null;
    }
    if (card.type === 'DEBIT') {
      return null;
    }
    if (card.accountId) {
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
      cardType: card.type,
      derivedAccountId: null,
      currency,
      name: card.name,
      institutionName: card.institution?.name ?? null,
      currentBalance: balanceRow ? Number(balanceRow.balance) : 0,
    };
  }

  /** Money out of the product in the period, used for the DGII suggestion. */
  async sumOutgoing(
    userId: string,
    target: ReconciliationTarget,
    from: Date,
    to: Date,
  ): Promise<number> {
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

  async create(
    userId: string,
    input: CreateReconciliationInput,
  ): Promise<ReconciliationRow> {
    return this.prisma.$transaction(async (tx) => {
      const ledgerTarget = await resolveLedgerTarget(
        tx,
        userId,
        input.target.accountId,
        input.target.cardId,
      );
      if (!ledgerTarget) {
        throw new Error('Reconciliation target no longer exists');
      }

      const reconciliation = await tx.finReconciliation.create({
        data: {
          userId,
          accountId: input.target.accountId,
          cardId: input.target.cardId,
          currency: input.target.currency,
          asOfDate: input.asOfDate,
          appBalance: input.appBalance,
          realBalance: input.realBalance,
          difference: input.difference,
          note: input.note,
        },
      });

      for (const adjustment of input.adjustments) {
        const categoryId = await this.findSystemCategoryId(tx, adjustment.kind);
        const created = await tx.finTransaction.create({
          data: {
            userId,
            accountId: ledgerTarget.accountId,
            cardId: ledgerTarget.cardId,
            categoryId,
            type: 'ADJUSTMENT',
            amount: adjustment.amounts.amount,
            ledgerAmount: adjustment.amounts.ledgerAmount,
            amountBaseCurrency: adjustment.amounts.amountBaseCurrency,
            currency: adjustment.amounts.currency,
            ledgerCurrency: adjustment.amounts.ledgerCurrency,
            exchangeRate: adjustment.amounts.exchangeRate,
            description: ADJUSTMENT_DESCRIPTION,
            source: 'MANUAL',
            status: 'CONFIRMED',
            transactionDate: input.asOfDate,
          },
        });

        await applyBalanceForTransaction(tx, {
          accountId: ledgerTarget.accountId,
          cardId: ledgerTarget.cardId,
          cardType: ledgerTarget.cardType,
          derivedAccountId: ledgerTarget.derivedAccountId,
          currency: adjustment.amounts.ledgerCurrency,
          type: 'ADJUSTMENT',
          amount: adjustment.amounts.ledgerAmount,
        });

        await tx.finReconciliationAdjustment.create({
          data: {
            reconciliationId: reconciliation.id,
            transactionId: created.id,
            kind: adjustment.kind,
            amount: adjustment.amounts.ledgerAmount,
          },
        });
      }

      return tx.finReconciliation.findFirstOrThrow({
        where: { id: reconciliation.id },
        include: reconciliationInclude,
      });
    });
  }

  async delete(
    userId: string,
    id: string,
  ): Promise<{ count: number; notLatest: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const reconciliation = await tx.finReconciliation.findFirst({
        where: { id, userId },
        include: {
          adjustments: { include: { transaction: true } },
        },
      });
      if (!reconciliation) {
        return { count: 0, notLatest: false };
      }

      const latest = await tx.finReconciliation.findFirst({
        where: {
          userId,
          currency: reconciliation.currency,
          ...(reconciliation.accountId
            ? { accountId: reconciliation.accountId }
            : { cardId: reconciliation.cardId }),
        },
        orderBy: [{ asOfDate: 'desc' }, { createdAt: 'desc' }],
        select: { id: true },
      });
      if (latest?.id !== reconciliation.id) {
        return { count: 0, notLatest: true };
      }

      const movements = reconciliation.adjustments.map(
        (adjustment) => adjustment.transaction,
      );
      for (const movement of movements) {
        const card = movement.cardId
          ? await tx.finCard.findFirst({
              where: { id: movement.cardId, userId },
              select: { type: true, accountId: true },
            })
          : null;
        await applyBalanceForTransaction(tx, {
          accountId: movement.accountId,
          cardId: movement.cardId,
          cardType: card?.type ?? null,
          derivedAccountId: card?.type === 'DEBIT' ? card.accountId : null,
          currency: movement.ledgerCurrency,
          type: 'ADJUSTMENT',
          amount: Number(movement.ledgerAmount),
          direction: -1,
        });
      }

      const reconciliationRow: Record<string, unknown> = {
        ...reconciliation,
      };
      delete reconciliationRow.adjustments;
      await this.journal.record(tx, {
        userId,
        entityType: DELETION_ENTITY.reconciliation,
        entityId: id,
        snapshot: {
          rows: [
            {
              model: DELETION_MODEL.reconciliation,
              values: toDeletionValues(reconciliationRow),
            },
            ...movements.map((movement) => ({
              model: DELETION_MODEL.transaction,
              values: toDeletionValues(movement),
            })),
            ...reconciliation.adjustments.map((adjustment) => ({
              model: DELETION_MODEL.reconciliationAdjustment,
              values: toDeletionValues({
                id: adjustment.id,
                reconciliationId: adjustment.reconciliationId,
                transactionId: adjustment.transactionId,
                kind: adjustment.kind,
                amount: adjustment.amount,
              }),
            })),
          ],
          ledgerReversed: movements.map((movement) => movement.id),
        },
      });

      await tx.finReconciliationAdjustment.deleteMany({
        where: { reconciliationId: id },
      });
      await tx.finTransaction.deleteMany({
        where: { id: { in: movements.map((movement) => movement.id) } },
      });
      await tx.finReconciliation.delete({ where: { id } });

      return { count: 1, notLatest: false };
    });
  }

  restore(userId: string, id: string, now: Date) {
    return this.journal.restore(
      userId,
      DELETION_ENTITY.reconciliation,
      id,
      now,
      (tx, snapshot) =>
        restoreLedgerRows(tx, userId, reversedMovements(snapshot)),
    );
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

  private async findSystemCategoryId(
    tx: Prisma.TransactionClient,
    kind: ReconciliationAdjustmentKind,
  ): Promise<string | null> {
    const category = await tx.finCategory.findFirst({
      where: {
        isSystem: true,
        systemKind: SYSTEM_KIND_BY_ADJUSTMENT_KIND[kind],
        type: 'EXPENSE',
      },
      select: { id: true },
    });
    return category?.id ?? null;
  }
}
