import { Injectable } from '@nestjs/common';
import type { CursorPoint } from '@personal-os/core';
import type {
  FinBillingCycle,
  FinSubscriptionAlertKind,
  FinSubscriptionStatus,
} from '@personal-os/database';
import { Prisma, PrismaService } from '@personal-os/database';
import {
  DEFAULT_SUBSCRIPTION_SORT,
  type SubscriptionFrequency,
  type SubscriptionSort,
} from '../domain/subscription-list';

export const SUBSCRIPTION_INCLUDE = {
  card: {
    select: {
      id: true,
      name: true,
      lastFour: true,
      color: true,
      institution: {
        select: {
          name: true,
          logoPath: true,
          customLogoPath: true,
          logoUrl: true,
        },
      },
    },
  },
  account: {
    select: {
      id: true,
      name: true,
      accountNumber: true,
      color: true,
      institutionRef: {
        select: {
          name: true,
          logoPath: true,
          customLogoPath: true,
          logoUrl: true,
        },
      },
    },
  },
  category: { select: { id: true, name: true, icon: true, color: true } },
  sourcePattern: { select: { id: true, merchant: true } },
  // Newest charge only: the card flags a subscription whose last charge does
  // not match the expected amount.
  payments: {
    select: { amount: true, paidAt: true },
    orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
    take: 1,
  },
} satisfies Prisma.FinSubscriptionInclude;

export type SubscriptionRow = Prisma.FinSubscriptionGetPayload<{
  include: typeof SUBSCRIPTION_INCLUDE;
}>;

export type SubscriptionPageQuery = {
  cursor: CursorPoint | null;
  take: number;
  status?: FinSubscriptionStatus;
  currency?: string;
  categoryId?: string;
  categoryIds?: string[];
  frequency?: SubscriptionFrequency;
  sort?: SubscriptionSort;
  cardId?: string;
  accountId?: string;
  unassignedCategory?: boolean;
  unassignedMethod?: boolean;
  search?: string;
};

const MONTHLY_CYCLE: FinBillingCycle = 'MONTHLY';
const YEARLY_CYCLE: FinBillingCycle = 'YEARLY';

function orderFor(
  sort: SubscriptionSort,
): Prisma.FinSubscriptionOrderByWithRelationInput[] {
  if (sort === 'AMOUNT') {
    return [{ amount: 'desc' }, { id: 'desc' }];
  }
  if (sort === 'NAME') {
    return [{ name: 'asc' }, { id: 'asc' }];
  }
  return [{ nextBillingDate: 'asc' }, { id: 'asc' }];
}

/** Keyset predicate that continues the page in the order the list uses. */
function cursorFilter(
  cursor: CursorPoint,
  sort: SubscriptionSort,
): Prisma.FinSubscriptionWhereInput {
  if (sort === 'AMOUNT') {
    const amount = new Prisma.Decimal(cursor.key);
    return {
      OR: [{ amount: { lt: amount } }, { amount, id: { lt: cursor.id } }],
    };
  }
  if (sort === 'NAME') {
    return {
      OR: [
        { name: { gt: cursor.key } },
        { name: cursor.key, id: { gt: cursor.id } },
      ],
    };
  }
  const date = new Date(cursor.key);
  return {
    OR: [
      { nextBillingDate: { gt: date } },
      { nextBillingDate: date, id: { gt: cursor.id } },
    ],
  };
}

function cycleFilter(
  frequency: SubscriptionFrequency | undefined,
): Prisma.FinSubscriptionWhereInput {
  if (frequency === 'MONTHLY') {
    return { billingCycle: MONTHLY_CYCLE };
  }
  if (frequency === 'YEARLY') {
    return { billingCycle: YEARLY_CYCLE };
  }
  if (frequency === 'OTHER') {
    return { billingCycle: { notIn: [MONTHLY_CYCLE, YEARLY_CYCLE] } };
  }
  return {};
}

function categoryFilter(
  query: SubscriptionPageQuery,
): Prisma.FinSubscriptionWhereInput {
  if (query.categoryIds && query.categoryIds.length > 0) {
    return { categoryId: { in: query.categoryIds } };
  }
  if (query.unassignedCategory) {
    return { categoryId: null };
  }
  return query.categoryId ? { categoryId: query.categoryId } : {};
}

export type PaymentPageQuery = {
  cursor: CursorPoint | null;
  take: number;
};

@Injectable()
export class SubscriptionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string, query: SubscriptionPageQuery) {
    const search = query.search?.trim();
    const sort = query.sort ?? DEFAULT_SUBSCRIPTION_SORT;
    return this.prisma.finSubscription.findMany({
      where: {
        userId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.currency ? { currency: query.currency } : {}),
        ...categoryFilter(query),
        ...cycleFilter(query.frequency),
        ...(query.unassignedMethod
          ? { cardId: null, accountId: null }
          : {
              ...(query.cardId ? { cardId: query.cardId } : {}),
              ...(query.accountId ? { accountId: query.accountId } : {}),
            }),
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
        ...(query.cursor ? cursorFilter(query.cursor, sort) : {}),
      },
      include: SUBSCRIPTION_INCLUDE,
      orderBy: orderFor(sort),
      take: query.take,
    });
  }

  findById(userId: string, id: string) {
    return this.prisma.finSubscription.findFirst({
      where: { id, userId },
      include: SUBSCRIPTION_INCLUDE,
    });
  }

  findActive(userId: string) {
    return this.prisma.finSubscription.findMany({
      where: { userId, status: 'ACTIVE' },
      include: SUBSCRIPTION_INCLUDE,
      orderBy: { nextBillingDate: 'asc' },
    });
  }

  findByStatus(userId: string, status: FinSubscriptionStatus) {
    return this.prisma.finSubscription.findMany({
      where: { userId, status },
      include: SUBSCRIPTION_INCLUDE,
      orderBy: { nextBillingDate: 'asc' },
    });
  }

  /** Payments of the given subscriptions, newest first. */
  listPaymentsForSubscriptions(subscriptionIds: string[]) {
    if (subscriptionIds.length === 0) {
      return Promise.resolve([]);
    }
    return this.prisma.finSubscriptionPayment.findMany({
      where: { subscriptionId: { in: subscriptionIds } },
      // The id tiebreak keeps the previous-charge lookup deterministic when
      // two payments share a timestamp, which the price-increase alert needs.
      orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
    });
  }

  listPaymentsInRange(userId: string, from: Date, to: Date) {
    return this.prisma.finSubscriptionPayment.findMany({
      where: {
        subscription: { userId },
        paidAt: { gte: from, lt: to },
      },
      select: { amount: true, currency: true, paidAt: true },
    });
  }

  listAlertDismissals(userId: string) {
    return this.prisma.finSubscriptionAlertDismissal.findMany({
      where: { userId },
      select: { subscriptionId: true, kind: true, alertDate: true },
    });
  }

  dismissAlert(input: {
    userId: string;
    subscriptionId: string;
    kind: FinSubscriptionAlertKind;
    alertDate: Date;
  }) {
    return this.prisma.finSubscriptionAlertDismissal.upsert({
      where: {
        subscriptionId_kind_alertDate: {
          subscriptionId: input.subscriptionId,
          kind: input.kind,
          alertDate: input.alertDate,
        },
      },
      create: {
        userId: input.userId,
        subscriptionId: input.subscriptionId,
        kind: input.kind,
        alertDate: input.alertDate,
      },
      update: {},
    });
  }

  dismissAlerts(
    rows: {
      userId: string;
      subscriptionId: string;
      kind: FinSubscriptionAlertKind;
      alertDate: Date;
    }[],
  ) {
    if (rows.length === 0) {
      return Promise.resolve({ count: 0 });
    }
    return this.prisma.finSubscriptionAlertDismissal.createMany({
      data: rows,
      skipDuplicates: true,
    });
  }

  countPendingDetected(userId: string) {
    return this.prisma.finRecurringPattern.count({
      where: { userId, status: 'SUGGESTED' },
    });
  }

  listUserIdsWithActive() {
    return this.prisma.finSubscription
      .groupBy({ by: ['userId'], where: { status: 'ACTIVE' } })
      .then((rows) => rows.map((row) => row.userId));
  }

  create(
    userId: string,
    data: Omit<Prisma.FinSubscriptionUncheckedCreateInput, 'userId'>,
  ) {
    return this.prisma.finSubscription.create({
      data: { ...data, userId },
      include: SUBSCRIPTION_INCLUDE,
    });
  }

  async update(
    userId: string,
    id: string,
    data: Prisma.FinSubscriptionUncheckedUpdateInput,
  ) {
    const updated = await this.prisma.finSubscription.updateMany({
      where: { id, userId },
      data,
    });
    if (updated.count === 0) {
      return null;
    }
    return this.findById(userId, id);
  }

  findPaymentByTransaction(subscriptionId: string, transactionId: string) {
    return this.prisma.finSubscriptionPayment.findUnique({
      where: {
        subscriptionId_transactionId: { subscriptionId, transactionId },
      },
    });
  }

  createPayment(
    data: Omit<Prisma.FinSubscriptionPaymentUncheckedCreateInput, 'id'>,
  ) {
    return this.prisma.finSubscriptionPayment.create({ data });
  }

  listPayments(
    userId: string,
    subscriptionId: string,
    query: PaymentPageQuery,
  ) {
    return this.prisma.finSubscriptionPayment.findMany({
      where: {
        subscriptionId,
        subscription: { userId },
        ...(query.cursor
          ? {
              OR: [
                { paidAt: { lt: new Date(query.cursor.key) } },
                {
                  paidAt: new Date(query.cursor.key),
                  id: { lt: query.cursor.id },
                },
              ],
            }
          : {}),
      },
      include: {
        transaction: {
          include: {
            account: { select: { id: true, name: true } },
            card: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
      take: query.take,
    });
  }

  findTransaction(userId: string, id: string) {
    return this.prisma.finTransaction.findFirst({
      where: { id, userId },
      select: {
        id: true,
        userId: true,
        merchant: true,
        amount: true,
        currency: true,
        type: true,
        status: true,
        transactionDate: true,
      },
    });
  }

  listUnmatchedRecentTransactions(userId: string, since: Date) {
    return this.prisma.finTransaction
      .findMany({
        where: {
          userId,
          status: 'CONFIRMED',
          type: 'DEBIT',
          merchant: { not: null },
          transactionDate: { gte: since },
          subscriptionPayments: { none: {} },
        },
        select: { id: true },
        orderBy: { transactionDate: 'desc' },
      })
      .then((rows) => rows.map((row) => row.id));
  }
}
