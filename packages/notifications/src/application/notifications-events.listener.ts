import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  AppEvents,
  DomainEventIdempotencyGuard,
  NotificationCreatedEvent,
} from '@personal-os/core';
import { FINANCE_NOTIFICATION_KEYS } from '@personal-os/users';
import { NotificationsService } from './notifications.service';

type FinanceTxEvent = {
  eventId?: string;
  userId: string;
  transactionId: string;
  amount: number;
  status?: string;
  source?: string;
};

type BudgetThresholdEvent = {
  eventId?: string;
  userId: string;
  budgetId: string;
  percentageUsed: number;
  alertId?: string;
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
      await this.createFinanceInApp(event.userId, {
        type: 'transaction.imported_pending',
        title: 'Bank email import pending review',
        body: `A ${event.amount} transaction from email needs confirmation.`,
        data: {
          moduleSlug: 'finance',
          notificationKey: FINANCE_NOTIFICATION_KEYS.transactionDetected,
          transactionId: event.transactionId,
          status: event.status,
        },
      });
      return;
    }

    if (event.status === 'DECLINED' || event.status === 'CANCELLED') {
      return;
    }

    if (event.status !== 'CONFIRMED') {
      return;
    }

    await this.createFinanceInApp(event.userId, {
      type: 'transaction.created',
      title: 'Transaction recorded',
      body: `A transaction of ${event.amount} was recorded.`,
      data: {
        moduleSlug: 'finance',
        notificationKey: FINANCE_NOTIFICATION_KEYS.transactionDetected,
        transactionId: event.transactionId,
        status: event.status,
      },
    });
  }

  @OnEvent(AppEvents.FINANCE_TRANSACTION_DELETED)
  async onFinanceTransactionDeleted(event: FinanceTxEvent): Promise<void> {
    await this.idempotency.tryClaim(
      event.eventId,
      `${NotificationsEventsListener.CONSUMER}:deleted`,
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
    await this.createFinanceInApp(event.userId, {
      type: 'transaction.updated',
      title: 'Transaction updated',
      body: `A transaction of ${event.amount} was updated.`,
      data: {
        moduleSlug: 'finance',
        notificationKey: FINANCE_NOTIFICATION_KEYS.transactionDetected,
        transactionId: event.transactionId,
      },
    });
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
    await this.createFinanceInApp(event.userId, {
      type: 'budget.threshold_reached',
      title: 'Budget threshold reached',
      body: `A budget reached ${Math.round(event.percentageUsed)}% of its limit.`,
      data: {
        moduleSlug: 'finance',
        notificationKey: FINANCE_NOTIFICATION_KEYS.budgetAlerts,
        budgetId: event.budgetId,
      },
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
