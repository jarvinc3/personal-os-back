import { FinanceEvents } from '../../contracts';
import { Inject, Injectable } from '@nestjs/common';
import { FinanceOutboxDispatcher } from '../../events/infrastructure/finance-outbox.dispatcher';
import { PrismaOutboxRepository } from '../../events/infrastructure/prisma-outbox.repository';
import { DOMAIN_EVENT_PUBLISHER } from '../../shared/application/tokens';
import type { DomainEventPublisherPort } from '../../events/application/ports/domain-event-publisher.port';
import {
  daysUntil,
  isChargeMissed,
  UPCOMING_REMINDER_DAYS,
} from '../domain/recurring-alerts';
import type {
  RecurringDetectionOutcome,
  RecurringPatternWithMerchant,
} from './recurring.service';

const AGGREGATE_TYPE = 'FinRecurringPattern';

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Turns the nightly detection result into idempotent domain events. The outbox
 * event id is stable per pattern and expected date, so a re-run the same day
 * does not notify twice.
 */
@Injectable()
export class RecurringAlertsService {
  constructor(
    @Inject(DOMAIN_EVENT_PUBLISHER)
    private readonly events: DomainEventPublisherPort,
    private readonly outbox: PrismaOutboxRepository,
    private readonly dispatcher: FinanceOutboxDispatcher,
  ) {}

  async evaluate(
    userId: string,
    outcome: RecurringDetectionOutcome,
    now: Date,
  ): Promise<void> {
    for (const change of outcome.priceChanges) {
      await this.emit(userId, {
        eventId: `finance-recurring-price:${change.patternId}:${change.newAmount}`,
        eventName: FinanceEvents.RECURRING_PRICE_CHANGED,
        aggregateId: change.patternId,
        payload: {
          patternId: change.patternId,
          merchant: change.merchant,
          currency: change.currency,
          previousAmount: change.previousAmount,
          newAmount: change.newAmount,
        },
      });
    }

    for (const pattern of outcome.patterns) {
      await this.evaluatePattern(userId, pattern, now);
    }

    void this.dispatcher.processBatch();
  }

  private async evaluatePattern(
    userId: string,
    pattern: RecurringPatternWithMerchant,
    now: Date,
  ): Promise<void> {
    const expectedIso = isoDate(pattern.nextExpectedDate);
    const amount = Number(pattern.avgAmount);
    if (
      isChargeMissed({ nextExpectedDate: pattern.nextExpectedDate, today: now })
    ) {
      await this.emit(userId, {
        eventId: `finance-recurring-missed:${pattern.id}:${expectedIso}`,
        eventName: FinanceEvents.RECURRING_MISSED,
        aggregateId: pattern.id,
        payload: {
          patternId: pattern.id,
          merchant: pattern.merchant,
          amount,
          currency: pattern.currency,
          nextExpectedDate: expectedIso,
        },
      });
      return;
    }

    const remaining = daysUntil(pattern.nextExpectedDate, now);
    if (remaining < 0 || remaining > UPCOMING_REMINDER_DAYS) {
      return;
    }
    await this.emit(userId, {
      eventId: `finance-recurring-upcoming:${pattern.id}:${expectedIso}`,
      eventName: FinanceEvents.RECURRING_UPCOMING,
      aggregateId: pattern.id,
      payload: {
        patternId: pattern.id,
        merchant: pattern.merchant,
        amount,
        currency: pattern.currency,
        nextExpectedDate: expectedIso,
        daysUntil: remaining,
      },
    });
  }

  private async emit(
    userId: string,
    input: {
      eventId: string;
      eventName: string;
      aggregateId: string;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    if (await this.outbox.hasEvent(input.eventId)) {
      return;
    }
    await this.events.enqueue({
      eventId: input.eventId,
      eventName: input.eventName,
      aggregateType: AGGREGATE_TYPE,
      aggregateId: input.aggregateId,
      userId,
      payload: input.payload,
    });
  }
}
