import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { NotificationIntentSink } from '@personal-os/contracts';
import { NOTIFICATION_INTENT_SINK } from '@personal-os/contracts';
import type {
  FinanceDomainEvent,
  FinanceEventName,
  FinanceEventPayloads,
} from '../contracts';
import { FINANCE_EVENT_VERSION, FinanceEvents } from '../contracts';
import { FinanceNotificationIntents } from './finance-notification-intents';

/** Envelope the outbox relay emits: the row identity plus its JSON payload. */
type EmittedFinanceEvent = {
  eventId?: unknown;
  userId?: unknown;
  aggregateType?: unknown;
  aggregateId?: unknown;
  occurredAt?: unknown;
  [key: string]: unknown;
};

/**
 * Finance turns its own events into neutral intents and hands them to the
 * sink. Notifications never sees Finance events or copy.
 */
@Injectable()
export class FinanceNotificationsListener {
  constructor(
    private readonly intents: FinanceNotificationIntents,
    @Inject(NOTIFICATION_INTENT_SINK)
    private readonly sink: NotificationIntentSink,
  ) {}

  @OnEvent(FinanceEvents.TRANSACTION_CONFIRMED, { suppressErrors: false })
  onTransactionConfirmed(event: EmittedFinanceEvent): Promise<void> {
    return this.publish(FinanceEvents.TRANSACTION_CONFIRMED, event);
  }

  @OnEvent(FinanceEvents.TRANSACTION_UPDATED, { suppressErrors: false })
  onTransactionUpdated(event: EmittedFinanceEvent): Promise<void> {
    return this.publish(FinanceEvents.TRANSACTION_UPDATED, event);
  }

  @OnEvent(FinanceEvents.BUDGET_THRESHOLD_CROSSED, { suppressErrors: false })
  onBudgetThresholdCrossed(event: EmittedFinanceEvent): Promise<void> {
    return this.publish(FinanceEvents.BUDGET_THRESHOLD_CROSSED, event);
  }

  @OnEvent(FinanceEvents.CARD_STATEMENT_REMINDER, { suppressErrors: false })
  onCardStatementReminder(event: EmittedFinanceEvent): Promise<void> {
    return this.publish(FinanceEvents.CARD_STATEMENT_REMINDER, event);
  }

  @OnEvent(FinanceEvents.CARD_PAYMENT_DUE, { suppressErrors: false })
  onCardPaymentDue(event: EmittedFinanceEvent): Promise<void> {
    return this.publish(FinanceEvents.CARD_PAYMENT_DUE, event);
  }

  @OnEvent(FinanceEvents.WEEKLY_SUMMARY, { suppressErrors: false })
  onWeeklySummary(event: EmittedFinanceEvent): Promise<void> {
    return this.publish(FinanceEvents.WEEKLY_SUMMARY, event);
  }

  @OnEvent(FinanceEvents.RECURRING_PRICE_CHANGED, { suppressErrors: false })
  onRecurringPriceChanged(event: EmittedFinanceEvent): Promise<void> {
    return this.publish(FinanceEvents.RECURRING_PRICE_CHANGED, event);
  }

  @OnEvent(FinanceEvents.RECURRING_MISSED, { suppressErrors: false })
  onRecurringMissed(event: EmittedFinanceEvent): Promise<void> {
    return this.publish(FinanceEvents.RECURRING_MISSED, event);
  }

  @OnEvent(FinanceEvents.RECURRING_UPCOMING, { suppressErrors: false })
  onRecurringUpcoming(event: EmittedFinanceEvent): Promise<void> {
    return this.publish(FinanceEvents.RECURRING_UPCOMING, event);
  }

  @OnEvent(FinanceEvents.SUBSCRIPTION_RENEWAL_DUE, { suppressErrors: false })
  onSubscriptionRenewalDue(event: EmittedFinanceEvent): Promise<void> {
    return this.publish(FinanceEvents.SUBSCRIPTION_RENEWAL_DUE, event);
  }

  @OnEvent(FinanceEvents.BALANCE_DRIFT_DETECTED, { suppressErrors: false })
  onBalanceDriftDetected(event: EmittedFinanceEvent): Promise<void> {
    return this.publish(FinanceEvents.BALANCE_DRIFT_DETECTED, event);
  }

  private async publish<TName extends FinanceEventName>(
    eventName: TName,
    emitted: EmittedFinanceEvent,
  ): Promise<void> {
    const event = this.domainEvent(eventName, emitted);
    for (const intent of this.intents.toIntents(event)) {
      await this.sink.submit(intent);
    }
  }

  private domainEvent(
    eventName: FinanceEventName,
    emitted: EmittedFinanceEvent,
  ): FinanceDomainEvent {
    if (typeof emitted.eventId !== 'string' || !emitted.eventId) {
      throw new Error(`Finance event ${eventName} arrived without an eventId`);
    }
    return {
      eventId: emitted.eventId,
      eventName,
      version: FINANCE_EVENT_VERSION,
      occurredAt:
        typeof emitted.occurredAt === 'string'
          ? emitted.occurredAt
          : new Date().toISOString(),
      userId: typeof emitted.userId === 'string' ? emitted.userId : null,
      aggregateType:
        typeof emitted.aggregateType === 'string' ? emitted.aggregateType : '',
      aggregateId:
        typeof emitted.aggregateId === 'string' ? emitted.aggregateId : '',
      payload: emitted as unknown as FinanceEventPayloads[FinanceEventName],
    } as FinanceDomainEvent;
  }
}
