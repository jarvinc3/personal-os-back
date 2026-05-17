import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  AiActionRequestedEvent,
  BudgetThresholdReachedEvent,
  TransactionCreatedEvent,
} from '../../core/events/domain-events';
import { AppEvents } from '../../core/events/event.constants';

@Injectable()
export class AiEventsListener {
  private readonly logger = new Logger(AiEventsListener.name);

  @OnEvent(AppEvents.TRANSACTION_CREATED)
  onTransactionCreated(event: TransactionCreatedEvent): void {
    this.logger.debug(
      `Transaction event received for AI enrichment: ${event.transactionId}`,
    );
  }

  @OnEvent(AppEvents.BUDGET_THRESHOLD_REACHED)
  onBudgetThresholdReached(event: BudgetThresholdReachedEvent): void {
    this.logger.debug(
      `Budget threshold event received for AI suggestion: ${event.budgetId}`,
    );
  }

  @OnEvent(AppEvents.AI_ACTION_REQUESTED)
  onAiActionRequested(event: AiActionRequestedEvent): void {
    this.logger.debug(
      `AI action requested for user ${event.userId}: ${event.actionType}`,
    );
  }
}
