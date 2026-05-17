import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { OnEvent } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import {
  AiActionRequestedEvent,
  BudgetThresholdReachedEvent,
  TransactionCreatedEvent,
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

  @OnEvent(AppEvents.TRANSACTION_CREATED)
  async onTransactionCreated(event: TransactionCreatedEvent): Promise<void> {
    this.logger.debug(
      `Transaction event received for AI enrichment: ${event.transactionId}`,
    );
    await this.aiProcessingQueue?.add('ai-enrich-transaction', {
      userId: event.userId,
      actionType: 'transaction.enrichment',
      payload: {
        transactionId: event.transactionId,
        amount: event.amount,
      },
    });
  }

  @OnEvent(AppEvents.BUDGET_THRESHOLD_REACHED)
  async onBudgetThresholdReached(
    event: BudgetThresholdReachedEvent,
  ): Promise<void> {
    this.logger.debug(
      `Budget threshold event received for AI suggestion: ${event.budgetId}`,
    );
    await this.aiProcessingQueue?.add('ai-budget-threshold', {
      userId: event.userId,
      actionType: 'budget.threshold_reached',
      payload: {
        budgetId: event.budgetId,
        percentageUsed: event.percentageUsed,
      },
    });
  }

  @OnEvent(AppEvents.AI_ACTION_REQUESTED)
  async onAiActionRequested(event: AiActionRequestedEvent): Promise<void> {
    this.logger.debug(
      `AI action requested for user ${event.userId}: ${event.actionType}`,
    );
    await this.aiProcessingQueue?.add('ai-action-requested', {
      userId: event.userId,
      actionType: event.actionType,
      payload: event.payload,
    });
  }
}
