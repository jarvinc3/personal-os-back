import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { OnEvent } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import {
  BudgetThresholdReachedEvent,
  TransactionCreatedEvent,
  TransactionUpdatedEvent,
  UserLoggedInEvent,
} from '../../core/events/domain-events';
import { AppEvents } from '../../core/events/event.constants';
import { QueueNames } from '../../core/queues/queue.constants';
import { AiProcessingJob } from '../../core/queues/queue-jobs';

@Injectable()
export class AiEventsListener {
  private readonly logger = new Logger(AiEventsListener.name);

  constructor(
    @Optional()
    @InjectQueue(QueueNames.AI_PROCESSING)
    private readonly aiProcessingQueue?: Queue<AiProcessingJob>,
  ) {}

  @OnEvent(AppEvents.USER_LOGGED_IN)
  async onUserLoggedIn(event: UserLoggedInEvent): Promise<void> {
    this.logger.debug(`User logged in — AI insight check: ${event.userId}`);
    await this.enqueue('ai-insight-login', event.userId, 'user.logged_in', {
      email: event.email,
    });
  }

  @OnEvent(AppEvents.USER_PREFERENCES_UPDATED)
  async onPreferencesUpdated(event: {
    userId: string;
    preferences: unknown;
  }): Promise<void> {
    await this.enqueue('ai-side-effect-preferences', event.userId, 'user.preferences.updated', {
      preferences: event.preferences,
    });
  }

  @OnEvent(AppEvents.MODULE_ENABLED)
  async onModuleEnabled(event: { userId: string; slug: string }): Promise<void> {
    await this.enqueue('ai-insight-module-enabled', event.userId, 'module.enabled', {
      slug: event.slug,
    });
  }

  @OnEvent(AppEvents.MODULE_DISABLED)
  async onModuleDisabled(event: { userId: string; slug: string }): Promise<void> {
    await this.enqueue('ai-insight-module-disabled', event.userId, 'module.disabled', {
      slug: event.slug,
    });
  }

  @OnEvent(AppEvents.MODULE_CONFIG_UPDATED)
  async onModuleConfigUpdated(event: { userId: string; slug: string }): Promise<void> {
    await this.enqueue('ai-insight-module-config', event.userId, 'module.config.updated', {
      slug: event.slug,
    });
  }

  @OnEvent(AppEvents.TRANSACTION_CREATED)
  async onTransactionCreated(event: TransactionCreatedEvent): Promise<void> {
    await this.enqueue(
      'ai-insight-transaction-created',
      event.userId,
      'transaction.created',
      {
        slug: 'finance',
        transactionId: event.transactionId,
        amount: event.amount,
      },
    );
  }

  @OnEvent(AppEvents.TRANSACTION_UPDATED)
  async onTransactionUpdated(event: TransactionUpdatedEvent): Promise<void> {
    await this.enqueue(
      'ai-insight-transaction-updated',
      event.userId,
      'transaction.updated',
      {
        slug: 'finance',
        transactionId: event.transactionId,
        amount: event.amount,
      },
    );
  }

  @OnEvent(AppEvents.BUDGET_THRESHOLD_REACHED)
  async onBudgetThresholdReached(
    event: BudgetThresholdReachedEvent,
  ): Promise<void> {
    await this.enqueue(
      'ai-insight-budget-threshold',
      event.userId,
      'budget.threshold_reached',
      {
        slug: 'finance',
        budgetId: event.budgetId,
        percentageUsed: event.percentageUsed,
      },
    );
  }

  private async enqueue(
    jobName: string,
    userId: string,
    actionType: string,
    payload: Record<string, unknown>,
  ) {
    await this.aiProcessingQueue?.add(jobName, {
      userId,
      actionType,
      payload,
    });
  }
}
