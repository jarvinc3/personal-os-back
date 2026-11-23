import { NotFoundException } from '@nestjs/common';
import { scalarNumber } from '../../shared/domain/money';
import {
  buildSubscriptionAlerts,
  type SubscriptionAlert,
} from '../domain/subscription-alerts';
import type { DismissSubscriptionAlertDto } from '../presentation/dto/dismiss-subscription-alert.dto';
import { SubscriptionsRepository } from '../infrastructure/subscriptions.repository';
import { dateOnly, isoDate } from './subscription-dates';
import { groupPaymentsBySubscription } from './subscription-payment-history';
import { SubscriptionReminderWindow } from './subscription-reminder-window';

type SubscriptionAlertFeedDeps = {
  repo: SubscriptionsRepository;
  reminderWindow: SubscriptionReminderWindow;
};

/** Alerts derived from the active subscriptions and their dismissals. */
export class SubscriptionAlertFeed {
  private readonly repo: SubscriptionsRepository;
  private readonly reminderWindow: SubscriptionReminderWindow;

  constructor({ repo, reminderWindow }: SubscriptionAlertFeedDeps) {
    this.repo = repo;
    this.reminderWindow = reminderWindow;
  }

  async alerts(userId: string, now = new Date()): Promise<SubscriptionAlert[]> {
    const active = await this.repo.findActive(userId);
    const payments = groupPaymentsBySubscription(
      await this.repo.listPaymentsForSubscriptions(active.map((row) => row.id)),
    );
    const dismissals = await this.repo.listAlertDismissals(userId);
    // The countdown alerts follow the global window, not the per-subscription
    // column kept in the database from the previous design.
    const reminderWindowDays = await this.reminderWindow.resolve(userId);
    const dismissed = new Set(
      dismissals.map(
        (row) => `${row.kind}:${row.subscriptionId}:${isoDate(row.alertDate)}`,
      ),
    );
    const alerts: SubscriptionAlert[] = [];
    for (const row of active) {
      const history = payments.get(row.id) ?? [];
      const derived = buildSubscriptionAlerts(
        {
          id: row.id,
          name: row.name,
          currency: row.currency,
          billingCycle: row.billingCycle,
          amount: scalarNumber(row.amount),
          nextBillingDate: row.nextBillingDate,
          trialEndsAt: row.trialEndsAt,
          reminderWindowDays,
          lastPaymentAmount: history[0]
            ? scalarNumber(history[0].amount)
            : null,
          lastPaymentDate: history[0]?.paidAt ?? null,
          previousPaymentAmount: history[1]
            ? scalarNumber(history[1].amount)
            : null,
          paidSinceNextBilling: history.some(
            (payment) => payment.paidAt >= row.nextBillingDate,
          ),
        },
        now,
      );
      for (const alert of derived) {
        if (dismissed.has(alert.id)) {
          continue;
        }
        alerts.push(alert);
      }
    }
    return alerts.sort((left, right) => left.date.localeCompare(right.date));
  }

  async dismissAllAlerts(userId: string, now = new Date()) {
    const alerts = await this.alerts(userId, now);
    await this.repo.dismissAlerts(
      alerts.map((alert) => ({
        userId,
        subscriptionId: alert.subscriptionId,
        kind: alert.kind,
        alertDate: dateOnly(new Date(alert.date)),
      })),
    );
    return { dismissed: alerts.length };
  }

  async dismissAlert(userId: string, dto: DismissSubscriptionAlertDto) {
    const subscription = await this.repo.findById(userId, dto.subscriptionId);
    if (!subscription) {
      throw new NotFoundException('Suscripción no encontrada');
    }
    const alertDate = dateOnly(new Date(dto.alertDate));
    await this.repo.dismissAlert({
      userId,
      subscriptionId: dto.subscriptionId,
      kind: dto.kind,
      alertDate,
    });
    return {
      id: `${dto.kind}:${dto.subscriptionId}:${isoDate(alertDate)}`,
      dismissed: true,
    };
  }
}
