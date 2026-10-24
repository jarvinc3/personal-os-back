import { createHash } from 'crypto';
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

  @OnEvent(AppEvents.FINANCE_TRANSACTION_CONFIRMED, { suppressErrors: false })
  async onTransactionConfirmed(event: FinanceTxEvent): Promise<void> {
    if (event.source === 'EMAIL') {
      return;
    }
    if (event.status && event.status !== 'CONFIRMED') {
      return;
    }
    await this.enqueueFromEvent(
      event.eventId,
      `${AiEventsListener.CONSUMER}:tx-confirmed`,
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
      `ai-tx-created-${event.transactionId}`,
    );
  }

  @OnEvent(AppEvents.FINANCE_EMAIL_SYNC_COMPLETED, { suppressErrors: false })
  async onEmailSyncCompleted(event: EmailSyncEvent): Promise<void> {
    if (event.transactionsNew <= 0) {
      return;
    }
    await this.enqueueFromEvent(
      event.eventId,
      `${AiEventsListener.CONSUMER}:email-sync`,
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
      `ai-email-sync-${event.sourceId}-${event.eventId ?? event.transactionIds[0] ?? 'none'}`,
    );
  }

  @OnEvent(AppEvents.FINANCE_TRANSACTION_UPDATED, { suppressErrors: false })
  async onTransactionUpdated(event: FinanceTxEvent): Promise<void> {
    await this.enqueueFromEvent(
      event.eventId,
      `${AiEventsListener.CONSUMER}:tx-updated`,
      'ai-insight-transaction-updated',
      event.userId,
      'finance.transaction.updated',
      {
        slug: 'finance',
        transactionId: event.transactionId,
        amount: event.amount,
        status: event.status,
      },
      `ai-tx-updated-${event.transactionId}-${event.status}`,
    );
  }

  @OnEvent(AppEvents.FINANCE_TRANSACTION_DELETED, { suppressErrors: false })
  async onTransactionDeleted(event: FinanceTxEvent): Promise<void> {
    await this.enqueueFromEvent(
      event.eventId,
      `${AiEventsListener.CONSUMER}:tx-deleted`,
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
      `ai-tx-deleted-${event.transactionId}`,
    );
  }

  @OnEvent(AppEvents.FINANCE_BUDGET_THRESHOLD_CROSSED, {
    suppressErrors: false,
  })
  async onBudgetThresholdReached(event: BudgetEvent): Promise<void> {
    await this.enqueueFromEvent(
      event.eventId,
      `${AiEventsListener.CONSUMER}:budget`,
      'ai-insight-budget-threshold',
      event.userId,
      'finance.budget.threshold_crossed',
      {
        slug: 'finance',
        budgetId: event.budgetId,
        percentageUsed: event.percentageUsed,
      },
      `ai-budget-threshold-${event.budgetId}`,
    );
  }

  @OnEvent(AppEvents.USER_DATA_WIPED)
  async onUserDataWiped(event: {
    eventId?: string;
    userId: string;
  }): Promise<void> {
    // Sessions were already deleted; claim only, never enqueue an insight job.
    if (this.idempotency) {
      await this.idempotency.tryClaim(
        event.eventId,
        `${AiEventsListener.CONSUMER}:data-wiped`,
      );
    }
  }

  private async enqueueFromEvent(
    eventId: string | undefined,
    consumer: string,
    jobName: string,
    userId: string,
    actionType: string,
    payload: Record<string, unknown>,
    fallbackJobId: string,
  ): Promise<void> {
    if (!eventId) {
      await this.enqueue(jobName, userId, actionType, payload, fallbackJobId);
      return;
    }
    if (!this.idempotency || !this.aiProcessingQueue) {
      throw new Error(
        'Durable AI event requires its queue and idempotency store',
      );
    }
    if (await this.idempotency.wasProcessed(eventId, consumer)) {
      return;
    }
    const key = createHash('sha256')
      .update(JSON.stringify([userId, consumer, eventId]))
      .digest('hex');
    // Redis is outside the DB transaction. Retain the job so a crash between
    // enqueue and receipt commit cannot enqueue a second job on replay.
    await this.enqueue(
      jobName,
      userId,
      actionType,
      payload,
      'ai-event-' + key,
      true,
    );
    await this.idempotency.tryClaim(eventId, consumer);
  }

  private async enqueue(
    jobName: string,
    userId: string,
    actionType: string,
    payload: Record<string, unknown>,
    jobId?: string,
    durable = false,
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
            removeOnComplete: durable ? false : 100,
            removeOnFail: durable ? false : 200,
          }
        : undefined,
    );
  }
}
