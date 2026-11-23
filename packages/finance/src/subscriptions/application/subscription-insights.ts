import { Prisma } from '@personal-os/database';
import { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import { toMoney } from '../../shared/domain/money';
import {
  billingOccurrencesInRange,
  daysUntil,
  monthlyCost,
} from '../domain/billing';
import type { SubscriptionRow } from '../infrastructure/subscriptions.repository';
import { SubscriptionsRepository } from '../infrastructure/subscriptions.repository';
import type { SubscriptionBreakdown } from '../presentation/dto/subscription-breakdown-query.dto';
import type { UpcomingSubscriptionsQueryDto } from '../presentation/dto/upcoming-subscriptions-query.dto';
import { SubscriptionCosts } from './subscription-costs';
import { dateOnly, isoDate } from './subscription-dates';
import { groupPaymentsBySubscription } from './subscription-payment-history';
import { SubscriptionReminderWindow } from './subscription-reminder-window';
import { SubscriptionView } from './subscription-view';

const UPCOMING_DEFAULT_DAYS = 30;

type SubscriptionInsightsDeps = {
  repo: SubscriptionsRepository;
  view: SubscriptionView;
  baseCurrency: ResolveUserBaseCurrencyUseCase;
  costs: SubscriptionCosts;
  reminderWindow: SubscriptionReminderWindow;
};

type BreakdownGroup = {
  key: string;
  label: string;
  color: string | null;
  count: number;
  amount: Prisma.Decimal;
};

/** Monthly, annual and breakdown indicators of the active subscriptions. */
export class SubscriptionInsights {
  private readonly repo: SubscriptionsRepository;
  private readonly view: SubscriptionView;
  private readonly baseCurrency: ResolveUserBaseCurrencyUseCase;
  private readonly costs: SubscriptionCosts;
  private readonly reminderWindow: SubscriptionReminderWindow;

  constructor({
    repo,
    view,
    baseCurrency,
    costs,
    reminderWindow,
  }: SubscriptionInsightsDeps) {
    this.repo = repo;
    this.view = view;
    this.baseCurrency = baseCurrency;
    this.costs = costs;
    this.reminderWindow = reminderWindow;
  }

  async summary(userId: string, now = new Date()) {
    const active = await this.repo.findActive(userId);
    const baseCurrency = await this.baseCurrency.execute(userId);
    const payments = groupPaymentsBySubscription(
      await this.repo.listPaymentsForSubscriptions(active.map((row) => row.id)),
    );
    const buckets = this.costs.buckets(active, payments);
    const monthlyTotal = await this.costs.sumBucketsInBase(
      buckets.monthly,
      baseCurrency,
      now,
    );
    const annualTotal = await this.costs.sumBucketsInBase(
      buckets.annual,
      baseCurrency,
      now,
    );
    const previousMonthlyTotal = await this.costs.sumBucketsInBase(
      buckets.previous,
      baseCurrency,
      now,
    );
    const months = this.costs.monthsAround(now);
    const [
      thisMonthPayments,
      previousMonthPayments,
      cancelled,
      pendingDetectedCount,
    ] = await Promise.all([
      this.repo.listPaymentsInRange(userId, months.start, months.next),
      this.repo.listPaymentsInRange(userId, months.previous, months.start),
      this.repo.findByStatus(userId, 'CANCELLED'),
      this.repo.countPendingDetected(userId),
    ]);
    const realSpendThisMonth = await this.costs.sumPaymentsInBase(
      thisMonthPayments,
      baseCurrency,
    );
    const realSpendPreviousMonth = await this.costs.sumPaymentsInBase(
      previousMonthPayments,
      baseCurrency,
    );
    const cancelledAnnualSavings = await this.costs.cancelledSavingsInBase(
      cancelled,
      baseCurrency,
      now,
    );
    const reminderWindowDays = await this.reminderWindow.resolve(userId);

    return {
      baseCurrency,
      activeCount: active.length,
      monthlyCost: monthlyTotal.toFixed(2),
      annualCost: annualTotal.toFixed(2),
      byCurrency: [...buckets.monthly.entries()]
        .map(([currency, monthly]) => ({
          currency,
          monthlyCost: monthly.toFixed(2),
          annualCost: (
            buckets.annual.get(currency) ?? new Prisma.Decimal(0)
          ).toFixed(2),
          activeCount: buckets.activeByCurrency.get(currency) ?? 0,
        }))
        .sort((left, right) => left.currency.localeCompare(right.currency)),
      previousMonthlyCost: previousMonthlyTotal.toFixed(2),
      realSpendThisMonth: realSpendThisMonth.toFixed(2),
      realSpendPreviousMonth: realSpendPreviousMonth.toFixed(2),
      trend: this.costs.trend(monthlyTotal, previousMonthlyTotal),
      pendingDetectedCount,
      cancelledAnnualSavings: cancelledAnnualSavings.toFixed(2),
      reminderWindowDays,
      upcoming: this.view.upcomingWithinWindow(active, now, reminderWindowDays),
    };
  }

  async breakdown(
    userId: string,
    by: SubscriptionBreakdown = 'category',
    now = new Date(),
  ) {
    const active = await this.repo.findActive(userId);
    const baseCurrency = await this.baseCurrency.execute(userId);
    const groups = new Map<string, BreakdownGroup>();
    for (const row of active) {
      await this.addToBreakdown({ groups, row, by, baseCurrency, now });
    }
    return {
      baseCurrency,
      by,
      items: [...groups.values()]
        .sort((left, right) => right.amount.comparedTo(left.amount))
        .map((group) => ({
          key: group.key,
          label: group.label,
          color: group.color,
          count: group.count,
          amount: group.amount.toFixed(2),
        })),
    };
  }

  async upcoming(
    userId: string,
    query: UpcomingSubscriptionsQueryDto,
    now = new Date(),
  ) {
    const active = await this.repo.findActive(userId);
    const from = query.from ? dateOnly(new Date(query.from)) : dateOnly(now);
    const to = query.to
      ? dateOnly(new Date(query.to))
      : this.addDays(from, query.days ?? UPCOMING_DEFAULT_DAYS);
    const items = active.flatMap((row) =>
      this.upcomingItems({ row, from, to, now }),
    );
    items.sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        left.name.localeCompare(right.name),
    );
    return { from: isoDate(from), to: isoDate(to), items };
  }

  private upcomingItems({
    row,
    from,
    to,
    now,
  }: {
    row: SubscriptionRow;
    from: Date;
    to: Date;
    now: Date;
  }) {
    return billingOccurrencesInRange(
      {
        anchor: row.anchorDate,
        cycle: row.billingCycle,
        interval: row.billingInterval,
      },
      from,
      to,
    ).map((date) => ({
      id: `${row.id}:${isoDate(date)}`,
      subscriptionId: row.id,
      name: row.name,
      logoUrl: this.view.logoUrl(row),
      amount: row.amount.toFixed(2),
      currency: row.currency,
      date: isoDate(date),
      daysUntil: daysUntil(date, now),
      paymentMethod: this.view.paymentMethod(row),
    }));
  }

  private async addToBreakdown({
    groups,
    row,
    by,
    baseCurrency,
    now,
  }: {
    groups: Map<string, BreakdownGroup>;
    row: SubscriptionRow;
    by: SubscriptionBreakdown;
    baseCurrency: string;
    now: Date;
  }): Promise<void> {
    const descriptor = this.view.breakdownDescriptor(row, by);
    const monthly = monthlyCost({
      amount: toMoney(row.amount),
      cycle: row.billingCycle,
      interval: row.billingInterval,
    });
    const inBase = await this.costs.toBaseCurrency({
      amount: monthly,
      currency: row.currency,
      baseCurrency,
      asOf: now,
    });
    const existing = groups.get(descriptor.key);
    groups.set(descriptor.key, {
      ...descriptor,
      count: (existing?.count ?? 0) + 1,
      amount: (existing?.amount ?? new Prisma.Decimal(0)).plus(inBase),
    });
  }

  private addDays(from: Date, days: number): Date {
    return new Date(from.getTime() + days * 86_400_000);
  }
}
