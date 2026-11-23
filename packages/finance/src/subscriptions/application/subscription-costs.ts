import { Prisma } from '@personal-os/database';
import { ResolveAmountsUseCase } from '../../fx/application/resolve-amounts.use-case';
import {
  normalizeCurrencyCode,
  ratioPercent,
  toMoney,
} from '../../shared/domain/money';
import { annualCost, monthlyCost } from '../domain/billing';
import type { SubscriptionRow } from '../infrastructure/subscriptions.repository';
import type { SubscriptionPaymentRow } from './subscription-payment-history';

export type SubscriptionCostBuckets = {
  monthly: Map<string, Prisma.Decimal>;
  annual: Map<string, Prisma.Decimal>;
  previous: Map<string, Prisma.Decimal>;
  activeByCurrency: Map<string, number>;
};

export type SubscriptionMonths = {
  start: Date;
  next: Date;
  previous: Date;
};

type PaymentTotalRow = {
  amount: Prisma.Decimal;
  currency: string;
  paidAt: Date;
};

/** Cost sums, base-currency conversion and monthly trend of subscriptions. */
export class SubscriptionCosts {
  constructor(private readonly resolveAmounts: ResolveAmountsUseCase) {}

  buckets(
    active: SubscriptionRow[],
    payments: Map<string, SubscriptionPaymentRow[]>,
  ): SubscriptionCostBuckets {
    const monthly = new Map<string, Prisma.Decimal>();
    const annual = new Map<string, Prisma.Decimal>();
    const previous = new Map<string, Prisma.Decimal>();
    const activeByCurrency = new Map<string, number>();
    for (const row of active) {
      const amount = toMoney(row.amount);
      const cycle = row.billingCycle;
      const interval = row.billingInterval;
      const currency = normalizeCurrencyCode(row.currency);
      activeByCurrency.set(currency, (activeByCurrency.get(currency) ?? 0) + 1);
      this.addToBucket(
        monthly,
        currency,
        monthlyCost({ amount, cycle, interval }),
      );
      this.addToBucket(
        annual,
        currency,
        annualCost({ amount, cycle, interval }),
      );
      // The previous price is the charge before the newest one; without a
      // second payment the subscription has not changed price yet.
      const history = payments.get(row.id) ?? [];
      const previousAmount = history[1] ? toMoney(history[1].amount) : amount;
      this.addToBucket(
        previous,
        currency,
        monthlyCost({ amount: previousAmount, cycle, interval }),
      );
    }
    return { monthly, annual, previous, activeByCurrency };
  }

  async sumBucketsInBase(
    buckets: Map<string, Prisma.Decimal>,
    baseCurrency: string,
    asOf: Date,
  ): Promise<Prisma.Decimal> {
    let total = new Prisma.Decimal(0);
    for (const [currency, amount] of buckets) {
      const inBase = await this.resolveAmounts.toBaseCurrency({
        amount,
        currency,
        baseCurrency,
        asOf,
      });
      total = total.plus(inBase);
    }
    return total;
  }

  async sumPaymentsInBase(
    payments: PaymentTotalRow[],
    baseCurrency: string,
  ): Promise<Prisma.Decimal> {
    let total = new Prisma.Decimal(0);
    for (const payment of payments) {
      const inBase = await this.resolveAmounts.toBaseCurrency({
        amount: payment.amount,
        currency: payment.currency,
        baseCurrency,
        asOf: payment.paidAt,
      });
      total = total.plus(inBase);
    }
    return total;
  }

  async cancelledSavingsInBase(
    rows: SubscriptionRow[],
    baseCurrency: string,
    asOf: Date,
  ): Promise<Prisma.Decimal> {
    let total = new Prisma.Decimal(0);
    for (const row of rows) {
      const annual = annualCost({
        amount: toMoney(row.amount),
        cycle: row.billingCycle,
        interval: row.billingInterval,
      });
      const inBase = await this.resolveAmounts.toBaseCurrency({
        amount: annual,
        currency: row.currency,
        baseCurrency,
        asOf,
      });
      total = total.plus(inBase);
    }
    return total;
  }

  trend(
    current: Prisma.Decimal,
    previous: Prisma.Decimal,
  ): { direction: 'up' | 'down' | 'flat'; percent: number } | null {
    if (previous.comparedTo(0) <= 0) {
      return null;
    }
    const percent =
      Math.round(ratioPercent(current.minus(previous), previous) * 10) / 10;
    if (percent === 0) {
      return { direction: 'flat', percent: 0 };
    }
    return { direction: percent > 0 ? 'up' : 'down', percent };
  }

  monthsAround(now: Date): SubscriptionMonths {
    return {
      start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      next: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
      previous: new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
      ),
    };
  }

  toBaseCurrency({
    amount,
    currency,
    baseCurrency,
    asOf,
  }: {
    amount: Prisma.Decimal;
    currency: string;
    baseCurrency: string;
    asOf: Date;
  }): Promise<Prisma.Decimal> {
    return this.resolveAmounts.toBaseCurrency({
      amount,
      currency,
      baseCurrency,
      asOf,
    });
  }

  private addToBucket(
    buckets: Map<string, Prisma.Decimal>,
    currency: string,
    amount: Prisma.Decimal,
  ): void {
    const current = buckets.get(currency) ?? new Prisma.Decimal(0);
    buckets.set(currency, current.plus(amount));
  }
}
