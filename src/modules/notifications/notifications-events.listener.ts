import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
    BudgetThresholdReachedEvent,
    NotificationCreatedEvent,
    TransactionCreatedEvent,
    TransactionUpdatedEvent,
} from '../../core/events/domain-events';
import { AppEvents } from '../../core/events/event.constants';
import { FINANCE_NOTIFICATION_KEYS } from '../users/defaults/user-settings-defaults';
import { NotificationsService } from './notifications.service';

@Injectable()
export class NotificationsEventsListener {
  private readonly logger = new Logger(NotificationsEventsListener.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  @OnEvent(AppEvents.NOTIFICATION_CREATED)
  onNotificationCreated(event: NotificationCreatedEvent): void {
    this.logger.debug(
      `event=notification.created handled=true notificationId=${event.notificationId} userId=${event.userId}`,
    );
  }

  @OnEvent(AppEvents.TRANSACTION_CREATED)
  async onTransactionCreated(event: TransactionCreatedEvent): Promise<void> {
    this.logger.debug(
      `event=transaction.created handled=true transactionId=${event.transactionId} userId=${event.userId}`,
    );
    await this.createFinanceInApp(event.userId, {
      type: 'transaction.created',
      title: 'New transaction',
      body: `A transaction of ${event.amount} was recorded.`,
      data: {
        moduleSlug: 'finance',
        notificationKey: FINANCE_NOTIFICATION_KEYS.transactionDetected,
        transactionId: event.transactionId,
      },
    });
  }

  @OnEvent(AppEvents.TRANSACTION_UPDATED)
  async onTransactionUpdated(event: TransactionUpdatedEvent): Promise<void> {
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

  @OnEvent(AppEvents.BUDGET_THRESHOLD_REACHED)
  async onBudgetThresholdReached(
    event: BudgetThresholdReachedEvent,
  ): Promise<void> {
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
