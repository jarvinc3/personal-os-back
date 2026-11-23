import type {
  FinBillingCycle,
  FinSubscriptionStatus,
} from '@personal-os/database';
import { LogoService } from '@personal-os/logos';
import { scalarNumber, toMoney } from '../../shared/domain/money';
import { annualCost, daysUntil, monthlyCost } from '../domain/billing';
import { lastChargeMismatch } from '../domain/subscription-alerts';
import type { SubscriptionRow } from '../infrastructure/subscriptions.repository';
import type { SubscriptionBreakdown } from '../presentation/dto/subscription-breakdown-query.dto';
import { isoDate } from './subscription-dates';

const UNCATEGORIZED_KEY = 'uncategorized';
const NO_INSTRUMENT_KEY = 'no-instrument';
const UNCATEGORIZED_LABEL = 'Sin categoría';
const NO_INSTRUMENT_LABEL = 'Sin método';

export type SubscriptionPaymentMethodView = {
  type: 'CARD' | 'ACCOUNT';
  id: string;
  name: string;
  institution: string | null;
  last4: string | null;
  logoUrl: string | null;
};

export type SubscriptionCategoryView = {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
};

export type SubscriptionBreakdownDescriptor = {
  key: string;
  label: string;
  color: string | null;
};

/** Public shape of a subscription, the same one `get` and the list return. */
export type SubscriptionViewRow = {
  id: string;
  name: string;
  normalizedKey: string;
  domain: string | null;
  logoUrl: string | null;
  amount: string;
  currency: string;
  billingCycle: FinBillingCycle;
  billingInterval: number;
  anchorDate: string;
  nextBillingDate: string;
  trialEndsAt: string | null;
  status: FinSubscriptionStatus;
  pausedAt: string | null;
  cancelledAt: string | null;
  reminderDaysBefore: number;
  lastChargeMismatch: boolean;
  lastPaymentAmount: string | null;
  lastRemindedFor: string | null;
  cardId: string | null;
  cardName: string | null;
  accountId: string | null;
  accountName: string | null;
  categoryId: string | null;
  category: SubscriptionCategoryView | null;
  paymentMethod: SubscriptionPaymentMethodView | null;
  manageUrl: string | null;
  notes: string | null;
  sourcePatternId: string | null;
  monthlyEquivalent: string;
  annualEquivalent: string;
  daysUntil: number;
  createdAt: string;
  updatedAt: string;
};

/** Read model of the subscription flow: response, method and breakdown views. */
export class SubscriptionView {
  constructor(private readonly logos: LogoService) {}

  map(row: SubscriptionRow, now: Date): SubscriptionViewRow {
    return {
      id: row.id,
      name: row.name,
      normalizedKey: row.normalizedKey,
      domain: row.domain,
      logoUrl: this.logoUrl(row),
      ...this.amountFields(row),
      ...this.scheduleFields(row),
      ...this.lifecycleFields(row),
      ...this.paymentFields(row),
      ...this.assignmentFields(row),
      ...this.equivalentFields(row),
      daysUntil: daysUntil(row.nextBillingDate, now),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  logoUrl(row: SubscriptionRow): string | null {
    return this.logos.resolveUrl(row);
  }

  paymentMethod(row: SubscriptionRow): SubscriptionPaymentMethodView | null {
    if (row.card) {
      return {
        type: 'CARD',
        id: row.card.id,
        name: row.card.name,
        institution: row.card.institution?.name ?? null,
        last4: row.card.lastFour ?? null,
        logoUrl: this.logos.resolveUrl(row.card.institution),
      };
    }
    if (row.account) {
      return {
        type: 'ACCOUNT',
        id: row.account.id,
        name: row.account.name,
        institution: row.account.institutionRef?.name ?? null,
        last4: row.account.accountNumberLast4 ?? null,
        logoUrl: this.logos.resolveUrl(row.account.institutionRef),
      };
    }
    return null;
  }

  breakdownDescriptor(
    row: SubscriptionRow,
    by: SubscriptionBreakdown,
  ): SubscriptionBreakdownDescriptor {
    if (by === 'currency') {
      return { key: row.currency, label: row.currency, color: null };
    }
    if (by === 'instrument') {
      return this.instrumentDescriptor(row);
    }
    return this.categoryDescriptor(row);
  }

  upcomingWithinWindow(
    rows: readonly SubscriptionRow[],
    now: Date,
    windowDays: number,
  ): Array<SubscriptionViewRow & { daysUntil: number }> {
    return rows
      .map((row) => ({ row, days: daysUntil(row.nextBillingDate, now) }))
      .filter((entry) => entry.days >= 0 && entry.days <= windowDays)
      .sort((left, right) => left.days - right.days)
      .map((entry) => ({
        ...this.map(entry.row, now),
        daysUntil: entry.days,
      }));
  }

  private amountFields(row: SubscriptionRow) {
    return {
      amount: row.amount.toFixed(2),
      currency: row.currency,
      billingCycle: row.billingCycle,
      billingInterval: row.billingInterval,
    };
  }

  private scheduleFields(row: SubscriptionRow) {
    return {
      anchorDate: isoDate(row.anchorDate),
      nextBillingDate: isoDate(row.nextBillingDate),
    };
  }

  private lifecycleFields(row: SubscriptionRow) {
    return {
      trialEndsAt: row.trialEndsAt ? isoDate(row.trialEndsAt) : null,
      status: row.status,
      pausedAt: row.pausedAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      reminderDaysBefore: row.reminderDaysBefore,
    };
  }

  private paymentFields(row: SubscriptionRow) {
    const lastPayment = row.payments[0];
    return {
      lastChargeMismatch: lastChargeMismatch({
        expectedAmount: scalarNumber(toMoney(row.amount)),
        lastPaymentAmount: lastPayment
          ? scalarNumber(lastPayment.amount)
          : null,
      }),
      lastPaymentAmount: lastPayment ? lastPayment.amount.toFixed(2) : null,
      lastRemindedFor: row.lastRemindedFor
        ? isoDate(row.lastRemindedFor)
        : null,
    };
  }

  private assignmentFields(row: SubscriptionRow) {
    return {
      cardId: row.cardId,
      cardName: row.card?.name ?? null,
      accountId: row.accountId,
      accountName: row.account?.name ?? null,
      categoryId: row.categoryId,
      category: this.category(row),
      paymentMethod: this.paymentMethod(row),
      manageUrl: row.manageUrl,
      notes: row.notes,
      sourcePatternId: row.sourcePatternId,
    };
  }

  private equivalentFields(row: SubscriptionRow) {
    const amount = toMoney(row.amount);
    return {
      monthlyEquivalent: monthlyCost({
        amount,
        cycle: row.billingCycle,
        interval: row.billingInterval,
      }).toFixed(2),
      annualEquivalent: annualCost({
        amount,
        cycle: row.billingCycle,
        interval: row.billingInterval,
      }).toFixed(2),
    };
  }

  private category(row: SubscriptionRow): SubscriptionCategoryView | null {
    if (!row.category) {
      return null;
    }
    return {
      id: row.category.id,
      name: row.category.name,
      icon: row.category.icon,
      color: row.category.color,
    };
  }

  private instrumentDescriptor(
    row: SubscriptionRow,
  ): SubscriptionBreakdownDescriptor {
    const method = this.paymentMethod(row);
    if (!method) {
      return {
        key: NO_INSTRUMENT_KEY,
        label: NO_INSTRUMENT_LABEL,
        color: null,
      };
    }
    return {
      key: `${method.type}:${method.id}`,
      label: method.name,
      color: row.card?.color ?? row.account?.color ?? null,
    };
  }

  private categoryDescriptor(
    row: SubscriptionRow,
  ): SubscriptionBreakdownDescriptor {
    if (!row.category) {
      return {
        key: UNCATEGORIZED_KEY,
        label: UNCATEGORIZED_LABEL,
        color: null,
      };
    }
    return {
      key: row.category.id,
      label: row.category.name,
      color: row.category.color,
    };
  }
}
