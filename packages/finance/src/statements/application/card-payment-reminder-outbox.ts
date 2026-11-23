import type {
  DomainEventOutboxReader,
  DomainEventPublisher,
  DomainEventRelay,
} from '@personal-os/contracts';
import {
  DOMAIN_EVENT_OUTBOX_READER,
  DOMAIN_EVENT_PUBLISHER,
  DOMAIN_EVENT_RELAY,
} from '@personal-os/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { FinanceEvents } from '../../contracts';

const AGGREGATE_TYPE = 'FinCardStatement';

export type CardPaymentReminderEvent = {
  eventId: string;
  statementId: string;
  userId: string;
  payload: {
    cardId: string;
    statementId: string;
    cardName: string;
    currency: string;
    closingBalance: number;
    remaining: number;
    minimumPayment: number;
    dueDate: string;
    daysUntil: number;
  };
};

/** Outbox side of a payment reminder: existence check, enqueue and relay wake. */
@Injectable()
export class CardPaymentReminderOutbox {
  constructor(
    @Inject(DOMAIN_EVENT_PUBLISHER)
    private readonly events: DomainEventPublisher,
    @Inject(DOMAIN_EVENT_OUTBOX_READER)
    private readonly outbox: DomainEventOutboxReader,
    @Inject(DOMAIN_EVENT_RELAY)
    private readonly relay: DomainEventRelay,
  ) {}

  hasEvent(eventId: string): Promise<boolean> {
    return this.outbox.hasEvent(eventId);
  }

  async publish(event: CardPaymentReminderEvent): Promise<void> {
    await this.events.enqueue({
      eventId: event.eventId,
      eventName: FinanceEvents.CARD_PAYMENT_DUE,
      aggregateType: AGGREGATE_TYPE,
      aggregateId: event.statementId,
      userId: event.userId,
      payload: event.payload,
    });
  }

  wake(): void {
    void this.relay.wake();
  }
}
