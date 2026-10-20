import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  AppEvents,
  DomainEventIdempotencyGuard,
  NotificationCreatedEvent,
} from '@personal-os/core';
import { FINANCE_NOTIFICATION_KEYS } from '@personal-os/users';
import {
  balanceDriftCopy,
  budgetThresholdCopy,
  cardPaymentDueCopy,
  cardStatementReminderCopy,
  formatNotificationAmount,
  recurringMissedCopy,
  recurringPriceChangedCopy,
  recurringUpcomingCopy,
  subscriptionRenewalDueCopy,
  transactionPendingCopy,
  transactionRecordedCopy,
  transactionUpdatedCopy,
  transferRecordedCopy,
  weeklySummaryCopy,
  type NotificationCopy,
} from '../domain/notification-copy';
import { NotificationsService } from './notifications.service';

const FINANCE_MODULE_SLUG = 'finance';
const TRANSFER_SOURCE_LEG = 'SOURCE';

type FinanceTxEvent = {
  eventId?: string;
  userId: string;
  transactionId: string;
  amount: number;
  currency?: string;
  status?: string;
  source?: string;
  transferGroupId?: string | null;
  legRole?: string | null;
  type?: string;
  merchant?: string | null;
  accountName?: string | null;
  cardName?: string | null;
  categoryName?: string | null;
  categoryIcon?: string | null;
  categoryColor?: string | null;
};

type BudgetThresholdEvent = {
  eventId?: string;
  userId: string;
  budgetId: string;
  percentageUsed: number;
  alertId?: string;
};

type CardStatementReminderEvent = {
  eventId?: string;
  userId: string;
  sourceId?: string;
  gmailMessageId?: string;
  subject?: string;
};

type CardPaymentDueEvent = {
  eventId?: string;
  userId: string;
  cardId: string;
  statementId: string;
  cardName?: string;
  currency?: string;
  remaining?: number;
  dueDate?: string;
  daysUntil?: number;
};

type WeeklySummaryEvent = {
  eventId?: string;
  userId: string;
  weekStart?: string;
  summary?: {
    currency?: string;
    expenses?: string;
    averageExpenses?: string;
    topCategories?: { name?: string }[];
    budgetsAtRisk?: unknown[];
    upcomingInstallments?: unknown[];
    pendingEmails?: number;
  };
};

type RecurringPriceChangeEvent = {
  eventId?: string;
  userId: string;
  patternId: string;
  merchant: string;
  currency?: string;
  previousAmount: number;
  newAmount: number;
};

type RecurringChargeEvent = {
  eventId?: string;
  userId: string;
  patternId: string;
  merchant: string;
  amount: number;
  currency?: string;
  nextExpectedDate?: string;
  daysUntil?: number;
};

type SubscriptionRenewalEvent = {
  eventId?: string;
  userId: string;
  subscriptionId: string;
  name: string;
  amount: number;
  currency?: string;
  nextBillingDate?: string;
  daysUntil?: number;
};

type BalanceDriftEvent = {
  eventId?: string;
  userId: string;
  driftId: string;
  accountId?: string | null;
  cardId?: string | null;
  currency?: string;
  name?: string | null;
  difference?: string;
};

@Injectable()
export class NotificationsEventsListener {
  private readonly logger = new Logger(NotificationsEventsListener.name);
  private static readonly CONSUMER = 'notifications';

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly idempotency: DomainEventIdempotencyGuard,
  ) {}

  @OnEvent(AppEvents.NOTIFICATION_CREATED)
  onNotificationCreated(event: NotificationCreatedEvent): void {
    this.logger.debug(
      `event=notification.created handled=true notificationId=${event.notificationId} userId=${event.userId}`,
    );
  }

  @OnEvent(AppEvents.FINANCE_TRANSACTION_CONFIRMED)
  @OnEvent(AppEvents.FINANCE_TRANSACTION_IMPORTED)
  async onFinanceTransactionCreated(event: FinanceTxEvent): Promise<void> {
    if (
      !(await this.idempotency.tryClaim(
        event.eventId,
        NotificationsEventsListener.CONSUMER,
      ))
    ) {
      return;
    }

    this.logger.debug(
      `event=finance.transaction handled=true transactionId=${event.transactionId} userId=${event.userId} status=${event.status}`,
    );

    if (event.source === 'EMAIL' && event.status === 'PENDING') {
      await this.createTransactionNotification(
        event,
        'transaction.imported_pending',
        transactionPendingCopy(this.transactionNotificationFields(event)),
      );
      return;
    }

    if (event.status === 'DECLINED' || event.status === 'CANCELLED') {
      return;
    }

    if (event.status !== 'CONFIRMED') {
      return;
    }

    if (event.transferGroupId) {
      await this.notifyTransfer(event);
      return;
    }

    await this.createTransactionNotification(
      event,
      'transaction.created',
      transactionRecordedCopy(this.transactionNotificationFields(event)),
    );
  }

  @OnEvent(AppEvents.FINANCE_TRANSACTION_DELETED)
  async onFinanceTransactionDeleted(event: FinanceTxEvent): Promise<void> {
    await this.idempotency.tryClaim(
      event.eventId,
      `${NotificationsEventsListener.CONSUMER}:deleted`,
    );
  }

  @OnEvent(AppEvents.USER_DATA_WIPED)
  async onUserDataWiped(event: {
    eventId?: string;
    userId: string;
  }): Promise<void> {
    // The wipe already removed notifications; claim only, never create any.
    await this.idempotency.tryClaim(
      event.eventId,
      `${NotificationsEventsListener.CONSUMER}:data-wiped`,
    );
  }

  @OnEvent(AppEvents.FINANCE_TRANSACTION_UPDATED)
  async onFinanceTransactionUpdated(event: FinanceTxEvent): Promise<void> {
    if (
      !(await this.idempotency.tryClaim(
        event.eventId,
        `${NotificationsEventsListener.CONSUMER}:updated`,
      ))
    ) {
      return;
    }
    await this.createTransactionNotification(
      event,
      'transaction.updated',
      transactionUpdatedCopy(this.transactionNotificationFields(event)),
    );
  }

  @OnEvent(AppEvents.FINANCE_BUDGET_THRESHOLD_CROSSED)
  async onBudgetThreshold(event: BudgetThresholdEvent): Promise<void> {
    if (
      !(await this.idempotency.tryClaim(
        event.eventId,
        `${NotificationsEventsListener.CONSUMER}:budget`,
      ))
    ) {
      return;
    }
    const budgetCopy = budgetThresholdCopy(event.percentageUsed);
    await this.createFinanceInApp(event.userId, {
      type: 'budget.threshold_reached',
      title: budgetCopy.title,
      body: budgetCopy.body,
      data: {
        moduleSlug: FINANCE_MODULE_SLUG,
        notificationKey: FINANCE_NOTIFICATION_KEYS.budgetAlerts,
        budgetId: event.budgetId,
        percentageUsed: event.percentageUsed,
      },
    });
  }

  @OnEvent(AppEvents.FINANCE_CARD_STATEMENT_REMINDER)
  async onCardStatementReminder(
    event: CardStatementReminderEvent,
  ): Promise<void> {
    if (
      !(await this.idempotency.tryClaim(
        event.eventId,
        `${NotificationsEventsListener.CONSUMER}:card-statement`,
      ))
    ) {
      return;
    }
    const copy = cardStatementReminderCopy();
    await this.createFinanceInApp(event.userId, {
      type: 'card.statement_reminder',
      title: copy.title,
      body: copy.body,
      data: {
        moduleSlug: FINANCE_MODULE_SLUG,
        reminder: 'card_statement',
        sourceId: event.sourceId ?? null,
      },
    });
  }

  @OnEvent(AppEvents.FINANCE_CARD_PAYMENT_DUE)
  async onCardPaymentDue(event: CardPaymentDueEvent): Promise<void> {
    if (
      !(await this.idempotency.tryClaim(
        event.eventId,
        `${NotificationsEventsListener.CONSUMER}:card-payment-due`,
      ))
    ) {
      return;
    }
    const copy = cardPaymentDueCopy({
      cardName: event.cardName?.trim() ? event.cardName : 'tu tarjeta',
      remainingLabel: formatNotificationAmount(
        Number(event.remaining ?? 0),
        event.currency ?? '',
      ),
      daysUntil: event.daysUntil ?? 0,
    });
    await this.createFinanceInApp(event.userId, {
      type: 'card.payment_due',
      title: copy.title,
      body: copy.body,
      data: {
        moduleSlug: FINANCE_MODULE_SLUG,
        notificationKey: FINANCE_NOTIFICATION_KEYS.cardDueDate,
        cardId: event.cardId,
        statementId: event.statementId,
        dueDate: event.dueDate ?? null,
      },
    });
  }

  @OnEvent(AppEvents.FINANCE_WEEKLY_SUMMARY)
  async onWeeklySummary(event: WeeklySummaryEvent): Promise<void> {
    if (
      !(await this.idempotency.tryClaim(
        event.eventId,
        `${NotificationsEventsListener.CONSUMER}:weekly-summary`,
      ))
    ) {
      return;
    }

    const summary = event.summary ?? {};
    const currency = summary.currency ?? '';
    const averageValue = Number(summary.averageExpenses ?? 0);
    const copy = weeklySummaryCopy({
      amountLabel: formatNotificationAmount(
        Number(summary.expenses ?? 0),
        currency,
      ),
      averageLabel:
        averageValue > 0
          ? formatNotificationAmount(averageValue, currency)
          : '',
      topCategories: (summary.topCategories ?? []).flatMap((category) =>
        category.name ? [category.name] : [],
      ),
      budgetsAtRisk: (summary.budgetsAtRisk ?? []).length,
      upcoming: (summary.upcomingInstallments ?? []).length,
      pendingEmails: summary.pendingEmails ?? 0,
    });

    await this.createFinanceInApp(event.userId, {
      type: 'finance.weekly_summary',
      title: copy.title,
      body: copy.body,
      data: {
        moduleSlug: FINANCE_MODULE_SLUG,
        notificationKey: FINANCE_NOTIFICATION_KEYS.weeklySummary,
        weekStart: event.weekStart ?? null,
      },
    });
  }

  @OnEvent(AppEvents.FINANCE_RECURRING_PRICE_CHANGED)
  async onRecurringPriceChanged(
    event: RecurringPriceChangeEvent,
  ): Promise<void> {
    if (
      !(await this.idempotency.tryClaim(
        event.eventId,
        `${NotificationsEventsListener.CONSUMER}:recurring-price`,
      ))
    ) {
      return;
    }
    const currency = event.currency ?? '';
    const copy = recurringPriceChangedCopy({
      merchant: event.merchant,
      previousLabel: formatNotificationAmount(event.previousAmount, currency),
      newLabel: formatNotificationAmount(event.newAmount, currency),
    });
    await this.createFinanceInApp(event.userId, {
      type: 'recurring.price_changed',
      title: copy.title,
      body: copy.body,
      data: {
        moduleSlug: FINANCE_MODULE_SLUG,
        notificationKey: FINANCE_NOTIFICATION_KEYS.priceIncreaseAlerts,
        patternId: event.patternId,
      },
    });
  }

  @OnEvent(AppEvents.FINANCE_SUBSCRIPTION_RENEWAL_DUE)
  async onSubscriptionRenewalDue(
    event: SubscriptionRenewalEvent,
  ): Promise<void> {
    if (
      !(await this.idempotency.tryClaim(
        event.eventId,
        `${NotificationsEventsListener.CONSUMER}:subscription-renewal`,
      ))
    ) {
      return;
    }
    const copy = subscriptionRenewalDueCopy({
      merchant: event.name,
      amountLabel: formatNotificationAmount(event.amount, event.currency ?? ''),
      daysUntil: event.daysUntil ?? 0,
    });
    await this.createFinanceInApp(event.userId, {
      type: 'subscription.renewal_due',
      title: copy.title,
      body: copy.body,
      data: {
        moduleSlug: FINANCE_MODULE_SLUG,
        notificationKey: FINANCE_NOTIFICATION_KEYS.subscriptionReminders,
        subscriptionId: event.subscriptionId,
        nextBillingDate: event.nextBillingDate ?? null,
      },
    });
  }

  @OnEvent(AppEvents.FINANCE_RECURRING_MISSED)
  async onRecurringMissed(event: RecurringChargeEvent): Promise<void> {
    await this.createRecurringCharge(event, 'recurring.missed', 'missed');
  }
  @OnEvent(AppEvents.FINANCE_RECURRING_UPCOMING)
  async onRecurringUpcoming(event: RecurringChargeEvent): Promise<void> {
    await this.createRecurringCharge(event, 'recurring.upcoming', 'upcoming');
  }

  @OnEvent(AppEvents.FINANCE_BALANCE_DRIFT_DETECTED)
  async onBalanceDrift(event: BalanceDriftEvent): Promise<void> {
    if (
      !(await this.idempotency.tryClaim(
        event.eventId,
        `${NotificationsEventsListener.CONSUMER}:balance-drift`,
      ))
    ) {
      return;
    }
    const copy = balanceDriftCopy({
      name: event.name?.trim() ? event.name : 'una cuenta',
      differenceLabel: formatNotificationAmount(
        Number(event.difference ?? 0),
        event.currency ?? '',
      ),
    });
    await this.createFinanceInApp(event.userId, {
      type: 'finance.balance_drift',
      title: copy.title,
      body: copy.body,
      data: {
        moduleSlug: FINANCE_MODULE_SLUG,
        notificationKey: FINANCE_NOTIFICATION_KEYS.balanceIntegrity,
        driftId: event.driftId,
        accountId: event.accountId ?? null,
        cardId: event.cardId ?? null,
        currency: event.currency ?? null,
      },
    });
  }

  private async createRecurringCharge(
    event: RecurringChargeEvent,
    type: string,
    copyKind: 'missed' | 'upcoming',
  ): Promise<void> {
    if (
      !(await this.idempotency.tryClaim(
        event.eventId,
        `${NotificationsEventsListener.CONSUMER}:${type}`,
      ))
    ) {
      return;
    }
    const amountLabel = formatNotificationAmount(
      event.amount,
      event.currency ?? '',
    );
    const copy =
      copyKind === 'missed'
        ? recurringMissedCopy({ merchant: event.merchant, amountLabel })
        : recurringUpcomingCopy({
            merchant: event.merchant,
            amountLabel,
            daysUntil: event.daysUntil ?? 0,
          });
    await this.createFinanceInApp(event.userId, {
      type,
      title: copy.title,
      body: copy.body,
      data: {
        moduleSlug: FINANCE_MODULE_SLUG,
        notificationKey: FINANCE_NOTIFICATION_KEYS.recurringAlerts,
        patternId: event.patternId,
      },
    });
  }

  /**
   * A transfer moves money between the user's own accounts: it notifies once,
   * from the source leg, instead of once per leg.
   */
  private async notifyTransfer(event: FinanceTxEvent): Promise<void> {
    if (event.legRole !== TRANSFER_SOURCE_LEG || !event.transferGroupId) {
      return;
    }
    const claimed = await this.idempotency.tryClaim(
      event.transferGroupId,
      `${NotificationsEventsListener.CONSUMER}:transfer`,
    );
    if (!claimed) {
      return;
    }
    await this.createTransactionNotification(
      event,
      'transaction.transfer',
      transferRecordedCopy(this.transactionNotificationFields(event)),
    );
  }

  private transactionNotificationFields(event: FinanceTxEvent) {
    return {
      type: event.type ?? '',
      amountLabel: formatNotificationAmount(event.amount, event.currency ?? ''),
      merchant: event.merchant ?? null,
      categoryName: event.categoryName ?? null,
      accountName: event.accountName ?? null,
      cardName: event.cardName ?? null,
    };
  }

  private transactionNotificationData(event: FinanceTxEvent) {
    return {
      moduleSlug: FINANCE_MODULE_SLUG,
      notificationKey: FINANCE_NOTIFICATION_KEYS.transactionDetected,
      transactionId: event.transactionId,
      status: event.status ?? null,
      amount: event.amount,
      currency: event.currency ?? null,
      merchant: event.merchant ?? null,
      accountName: event.accountName ?? null,
      cardName: event.cardName ?? null,
      categoryName: event.categoryName ?? null,
      categoryIcon: event.categoryIcon ?? null,
      categoryColor: event.categoryColor ?? null,
    };
  }

  private async createTransactionNotification(
    event: FinanceTxEvent,
    type: string,
    copy: NotificationCopy,
  ): Promise<void> {
    await this.createFinanceInApp(event.userId, {
      type,
      title: copy.title,
      body: copy.body,
      data: this.transactionNotificationData(event),
    });
  }

  private async createFinanceInApp(
    userId: string,
    input: {
      type: string;
      title: string;
      body: string;
      data: Record<string, unknown>;
    },
  ): Promise<void> {
    try {
      await this.notificationsService.create(userId, {
        type: input.type,
        channel: 'IN_APP',
        title: input.title,
        body: input.body,
        data: input.data,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to create ${input.type} notification for user ${userId}: ${message}`,
      );
    }
  }
}
