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
import { NotificationsGateway } from '../presentation/notifications.gateway';

const FINANCE_MODULE_SLUG = 'finance';
const TRANSFER_SOURCE_LEG = 'SOURCE';

type FinanceTxEvent = {
  eventId?: string;
  userId: string;
  transactionId: string;
  /** `false` for a movement that is a side effect the user already confirmed. */
  announce?: boolean;
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

type AiEmailSyncUpdatedEvent = {
  userId: string;
  state: Record<string, unknown>;
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
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  @OnEvent(AppEvents.AI_EMAIL_SYNC_UPDATED)
  onAiEmailSyncUpdated(event: AiEmailSyncUpdatedEvent): void {
    this.notificationsGateway.emitToUser(
      event.userId,
      'ai.email.sync.updated',
      {
        state: event.state,
      },
    );
  }

  @OnEvent(AppEvents.NOTIFICATION_CREATED)
  onNotificationCreated(event: NotificationCreatedEvent): void {
    this.logger.debug(
      `event=notification.created handled=true notificationId=${event.notificationId} userId=${event.userId}`,
    );
  }

  @OnEvent(AppEvents.FINANCE_TRANSACTION_CONFIRMED, { suppressErrors: false })
  @OnEvent(AppEvents.FINANCE_TRANSACTION_IMPORTED, { suppressErrors: false })
  async onFinanceTransactionCreated(event: FinanceTxEvent): Promise<void> {
    this.logger.debug(
      `event=finance.transaction handled=true transactionId=${event.transactionId} userId=${event.userId} status=${event.status}`,
    );

    // One fact, one notice: a contribution or prepayment already announced
    // itself on screen, so its internal movement stays quiet.
    if (event.announce === false) {
      return;
    }

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

  @OnEvent(AppEvents.FINANCE_TRANSACTION_DELETED, { suppressErrors: false })
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

  @OnEvent(AppEvents.FINANCE_TRANSACTION_UPDATED, { suppressErrors: false })
  async onFinanceTransactionUpdated(event: FinanceTxEvent): Promise<void> {
    await this.createTransactionNotification(
      event,
      'transaction.updated',
      transactionUpdatedCopy(this.transactionNotificationFields(event)),
    );
  }

  @OnEvent(AppEvents.FINANCE_BUDGET_THRESHOLD_CROSSED, {
    suppressErrors: false,
  })
  async onBudgetThreshold(event: BudgetThresholdEvent): Promise<void> {
    const budgetCopy = budgetThresholdCopy(event.percentageUsed);
    await this.createFinanceInApp(event, {
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

  @OnEvent(AppEvents.FINANCE_CARD_STATEMENT_REMINDER, { suppressErrors: false })
  async onCardStatementReminder(
    event: CardStatementReminderEvent,
  ): Promise<void> {
    const copy = cardStatementReminderCopy();
    await this.createFinanceInApp(event, {
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

  @OnEvent(AppEvents.FINANCE_CARD_PAYMENT_DUE, { suppressErrors: false })
  async onCardPaymentDue(event: CardPaymentDueEvent): Promise<void> {
    const copy = cardPaymentDueCopy({
      cardName: event.cardName?.trim() ? event.cardName : 'tu tarjeta',
      remainingLabel: formatNotificationAmount(
        Number(event.remaining ?? 0),
        event.currency ?? '',
      ),
      daysUntil: event.daysUntil ?? 0,
    });
    await this.createFinanceInApp(event, {
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

  @OnEvent(AppEvents.FINANCE_WEEKLY_SUMMARY, { suppressErrors: false })
  async onWeeklySummary(event: WeeklySummaryEvent): Promise<void> {
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

    await this.createFinanceInApp(event, {
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

  @OnEvent(AppEvents.FINANCE_RECURRING_PRICE_CHANGED, { suppressErrors: false })
  async onRecurringPriceChanged(
    event: RecurringPriceChangeEvent,
  ): Promise<void> {
    const currency = event.currency ?? '';
    const copy = recurringPriceChangedCopy({
      merchant: event.merchant,
      previousLabel: formatNotificationAmount(event.previousAmount, currency),
      newLabel: formatNotificationAmount(event.newAmount, currency),
    });
    await this.createFinanceInApp(event, {
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

  @OnEvent(AppEvents.FINANCE_SUBSCRIPTION_RENEWAL_DUE, {
    suppressErrors: false,
  })
  async onSubscriptionRenewalDue(
    event: SubscriptionRenewalEvent,
  ): Promise<void> {
    const copy = subscriptionRenewalDueCopy({
      merchant: event.name,
      amountLabel: formatNotificationAmount(event.amount, event.currency ?? ''),
      daysUntil: event.daysUntil ?? 0,
    });
    await this.createFinanceInApp(event, {
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

  @OnEvent(AppEvents.FINANCE_RECURRING_MISSED, { suppressErrors: false })
  async onRecurringMissed(event: RecurringChargeEvent): Promise<void> {
    await this.createRecurringCharge(event, 'recurring.missed', 'missed');
  }
  @OnEvent(AppEvents.FINANCE_RECURRING_UPCOMING, { suppressErrors: false })
  async onRecurringUpcoming(event: RecurringChargeEvent): Promise<void> {
    await this.createRecurringCharge(event, 'recurring.upcoming', 'upcoming');
  }

  @OnEvent(AppEvents.FINANCE_BALANCE_DRIFT_DETECTED, { suppressErrors: false })
  async onBalanceDrift(event: BalanceDriftEvent): Promise<void> {
    const copy = balanceDriftCopy({
      name: event.name?.trim() ? event.name : 'una cuenta',
      differenceLabel: formatNotificationAmount(
        Number(event.difference ?? 0),
        event.currency ?? '',
      ),
    });
    await this.createFinanceInApp(event, {
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
    await this.createFinanceInApp(event, {
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
    await this.createTransactionNotification(
      { ...event, eventId: event.transferGroupId },
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
    await this.createFinanceInApp(event, {
      type,
      title: copy.title,
      body: copy.body,
      data: this.transactionNotificationData(event),
    });
  }

  private async createFinanceInApp(
    event: { userId: string; eventId?: string },
    input: {
      type: string;
      title: string;
      body: string;
      data: Record<string, unknown>;
    },
  ): Promise<void> {
    // Keep the existing receipt keys valid across the deployment.
    const consumers: Record<string, string> = {
      'transaction.created': 'notifications',
      'transaction.imported_pending': 'notifications',
      'transaction.updated': 'notifications:updated',
      'transaction.transfer': 'notifications:transfer',
      'budget.threshold_reached': 'notifications:budget',
      'card.statement_reminder': 'notifications:card-statement',
      'card.payment_due': 'notifications:card-payment-due',
      'finance.weekly_summary': 'notifications:weekly-summary',
      'recurring.price_changed': 'notifications:recurring-price',
      'subscription.renewal_due': 'notifications:subscription-renewal',
      'recurring.missed': 'notifications:recurring.missed',
      'recurring.upcoming': 'notifications:recurring.upcoming',
      'finance.balance_drift': 'notifications:balance-drift',
    };
    const consumer = consumers[input.type];
    if (!consumer) {
      throw new Error('Missing notification consumer: ' + input.type);
    }
    const created = await this.idempotency.runOnce(
      event.eventId,
      consumer,
      (tx) =>
        this.notificationsService.create(
          event.userId,
          {
            type: input.type,
            channel: 'IN_APP',
            title: input.title,
            body: input.body,
            data: input.data,
          },
          tx,
        ),
    );
    if (created) {
      this.notificationsService.publishInApp(created);
    }
  }
}
