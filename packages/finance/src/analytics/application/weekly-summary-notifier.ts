import type {
  DomainEventRelay,
  DomainEventOutboxReader,
  DomainEventPublisher,
} from '@personal-os/contracts';
import {
  DOMAIN_EVENT_RELAY,
  DOMAIN_EVENT_OUTBOX_READER,
  DOMAIN_EVENT_PUBLISHER,
} from '@personal-os/contracts';
import { FinanceEvents } from '../../contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { WeeklySummary } from './weekly-summary.types';

const CONSUMER_AGGREGATE = 'User';

function weeklySummaryEventId(userId: string, weekStart: string): string {
  return `finance-weekly-summary:${userId}:${weekStart}`;
}

/** Publishes one weekly summary once per user and week through the outbox. */
@Injectable()
export class WeeklySummaryNotifier {
  constructor(
    @Inject(DOMAIN_EVENT_PUBLISHER)
    private readonly events: DomainEventPublisher,
    @Inject(DOMAIN_EVENT_OUTBOX_READER)
    private readonly outbox: DomainEventOutboxReader,
    @Inject(DOMAIN_EVENT_RELAY)
    private readonly relay: DomainEventRelay,
  ) {}

  hasBeenSent(userId: string, weekStart: string): Promise<boolean> {
    return this.outbox.hasEvent(weeklySummaryEventId(userId, weekStart));
  }

  async notify(input: {
    userId: string;
    weekStart: string;
    summary: WeeklySummary;
  }): Promise<void> {
    const { userId, weekStart, summary } = input;
    await this.events.enqueue({
      eventId: weeklySummaryEventId(userId, weekStart),
      eventName: FinanceEvents.WEEKLY_SUMMARY,
      aggregateType: CONSUMER_AGGREGATE,
      aggregateId: userId,
      userId,
      payload: { weekStart, summary },
    });
    void this.relay.wake();
  }
}
