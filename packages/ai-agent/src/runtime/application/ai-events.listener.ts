import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import {
  AppEvents,
  DomainEventIdempotencyGuard,
  QueueNames,
  UserLoggedInEvent,
  type AiProcessingJob,
} from '@personal-os/core';

type FinanceTxEvent = {
  eventId?: string;
  userId: string;
  transactionId: string;
  amount: number;
  status?: string;
  source?: string;
  transferGroupId?: string | null;
};

type BudgetEvent = {
  eventId?: string;
  userId: string;
  budgetId: string;
  percentageUsed: number;
};

type EmailSyncEvent = {
  eventId?: string;
  userId: string;
  sourceId: string;
  emailsScanned: number;
  transactionsNew: number;
  transactionIds: string[];
  countsByStatus: Record<string, number>;
};

@Injectable()
export class AiEventsListener {
  private readonly logger = new Logger(AiEventsListener.name);
  private static readonly CONSUMER = 'ai-agent';

  constructor(
    @Optional()
    @InjectQueue(QueueNames.AI_PROCESSING)
    private readonly aiProcessingQueue?: Queue<AiProcessingJob>,
    private readonly idempotency?: DomainEventIdempotencyGuard,
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
    await this.enqueue(
      'ai-side-effect-preferences',
      event.userId,
      'user.preferences.updated',
      { preferences: event.preferences },
    );
  }

  @OnEvent(AppEvents.MODULE_ENABLED)
  async onModuleEnabled(event: {
    userId: string;
    slug: string;
  }): Promise<void> {
    await this.enqueue(
      'ai-insight-module-enabled',
      event.userId,
      'module.enabled',
      {
        slug: event.slug,
      },
    );
  }

  @OnEvent(AppEvents.MODULE_DISABLED)
  async onModuleDisabled(event: {
    userId: string;
    slug: string;
  }): Promise<void> {
    await this.enqueue(
      'ai-insight-module-disabled',
      event.userId,
      'module.disabled',
      {
        slug: event.slug,
      },
    );
  }

  @OnEvent(AppEvents.MODULE_CONFIG_UPDATED)
  async onModuleConfigUpdated(event: {
    userId: string;
    slug: string;
  }): Promise<void> {
    await this.enqueue(
      'ai-insight-module-config',
      event.userId,
      'module.config.updated',
      { slug: event.slug },
    );
  }

  @OnEvent(AppEvents.FINANCE_TRANSACTION_CONFIRMED)
  async onTransactionConfirmed(event: FinanceTxEvent): Promise<void> {
    if (event.source === 'EMAIL') {
      return;
    }
    if (event.status && event.status !== 'CONFIRMED') {
      return;
    }
    if (
      this.idempotency &&
      !(await this.idempotency.tryClaim(
        event.eventId,
        `${AiEventsListener.CONSUMER}:tx-confirmed`,
      ))
    ) {
      return;
    }
    await this.enqueue(
      'ai-insight-transaction-created',
      event.userId,
      'finance.transaction.confirmed',
      {
        slug: 'finance',
        transactionId: event.transactionId,
        amount: event.amount,
        status: event.status ?? 'CONFIRMED',
        source: event.source,
      },
      `ai:tx-created:${event.transactionId}`,
    );
  }

  @OnEvent(AppEvents.FINANCE_EMAIL_SYNC_COMPLETED)
  async onEmailSyncCompleted(event: EmailSyncEvent): Promise<void> {
    if (event.transactionsNew <= 0) {
      return;
    }
    if (
      this.idempotency &&
      !(await this.idempotency.tryClaim(
        event.eventId,
        `${AiEventsListener.CONSUMER}:email-sync`,
      ))
    ) {
      return;
    }
    await this.enqueue(
      'ai-insight-email-sync',
      event.userId,
      'finance.email_sync.completed',
      {
        slug: 'finance',
        sourceId: event.sourceId,
        emailsScanned: event.emailsScanned,
        transactionsNew: event.transactionsNew,
        transactionIds: event.transactionIds,
        countsByStatus: event.countsByStatus,
      },
      `ai:email-sync:${event.sourceId}:${event.eventId ?? event.transactionIds[0] ?? 'none'}`,
    );
  }

  @OnEvent(AppEvents.FINANCE_TRANSACTION_UPDATED)
  async onTransactionUpdated(event: FinanceTxEvent): Promise<void> {
    if (
      this.idempotency &&
      !(await this.idempotency.tryClaim(
        event.eventId,
        `${AiEventsListener.CONSUMER}:tx-updated`,
      ))
    ) {
      return;
    }
    await this.enqueue(
      'ai-insight-transaction-updated',
      event.userId,
      'finance.transaction.updated',
      {
        slug: 'finance',
        transactionId: event.transactionId,
        amount: event.amount,
        status: event.status,
      },
      `ai:tx-updated:${event.transactionId}:${event.status}`,
    );
  }

  @OnEvent(AppEvents.FINANCE_TRANSACTION_DELETED)
  async onTransactionDeleted(event: FinanceTxEvent): Promise<void> {
    if (
      this.idempotency &&
      !(await this.idempotency.tryClaim(
        event.eventId,
        `${AiEventsListener.CONSUMER}:tx-deleted`,
      ))
    ) {
      return;
    }
    await this.enqueue(
      'ai-insight-transaction-deleted',
      event.userId,
      'finance.transaction.deleted',
      {
        slug: 'finance',
        transactionId: event.transactionId,
        amount: event.amount,
        status: event.status,
        transferGroupId: event.transferGroupId,
      },
      `ai:tx-deleted:${event.transactionId}`,
    );
  }

  @OnEvent(AppEvents.FINANCE_BUDGET_THRESHOLD_CROSSED)
  async onBudgetThresholdReached(event: BudgetEvent): Promise<void> {
    if (
      this.idempotency &&
      !(await this.idempotency.tryClaim(
        event.eventId,
        `${AiEventsListener.CONSUMER}:budget`,
      ))
    ) {
      return;
    }
    await this.enqueue(
      'ai-insight-budget-threshold',
      event.userId,
      'finance.budget.threshold_crossed',
      {
        slug: 'finance',
        budgetId: event.budgetId,
        percentageUsed: event.percentageUsed,
      },
      `ai:budget-threshold:${event.budgetId}`,
    );
  }

  private async enqueue(
    jobName: string,
    userId: string,
    actionType: string,
    payload: Record<string, unknown>,
    jobId?: string,
  ) {
    if (!this.aiProcessingQueue) {
      this.logger.warn(
        `AI processing queue unavailable; dropped event actionType=${actionType} userId=${userId}`,
      );
      return;
    }
    await this.aiProcessingQueue.add(
      jobName,
      { userId, actionType, payload },
      jobId
        ? {
            jobId,
            removeOnComplete: 100,
            removeOnFail: 200,
          }
        : undefined,
    );
  }
}
