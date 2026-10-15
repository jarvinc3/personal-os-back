import { Inject, Injectable } from '@nestjs/common';
import { AppEvents } from '@personal-os/core';
import {
  resolveSubscriptionReminderDays,
  UsersService,
} from '@personal-os/users';
import { FinanceOutboxDispatcher } from '../../events/infrastructure/finance-outbox.dispatcher';
import { PrismaOutboxRepository } from '../../events/infrastructure/prisma-outbox.repository';
import { scalarNumber } from '../../shared/domain/money';
import { DOMAIN_EVENT_PUBLISHER } from '../../shared/application/tokens';
import type { DomainEventPublisherPort } from '../../events/application/ports/domain-event-publisher.port';
import { daysUntil } from '../domain/billing';
import { SubscriptionsRepository } from '../infrastructure/subscriptions.repository';

const AGGREGATE_TYPE = 'FinSubscription';
const FINANCE_MODULE_SLUG = 'finance';

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function localDateIso(timezone: string | null, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone ?? 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Renewal reminders for active subscriptions; at most one per billing date. */
@Injectable()
export class SubscriptionRemindersService {
  constructor(
    private readonly repo: SubscriptionsRepository,
    private readonly users: UsersService,
    @Inject(DOMAIN_EVENT_PUBLISHER)
    private readonly events: DomainEventPublisherPort,
    private readonly outbox: PrismaOutboxRepository,
    private readonly dispatcher: FinanceOutboxDispatcher,
  ) {}

  async evaluate(userId: string, now = new Date()): Promise<void> {
    const profile = await this.users.findById(userId);
    const today = new Date(
      `${localDateIso(profile?.timezone ?? null, now)}T00:00:00.000Z`,
    );
    const windowDays = resolveSubscriptionReminderDays(
      profile?.userModules.find((module) => module.slug === FINANCE_MODULE_SLUG)
        ?.config,
    );
    const active = await this.repo.findActive(userId);
    for (const subscription of active) {
      const expected = isoDate(subscription.nextBillingDate);
      if (daysUntil(subscription.nextBillingDate, today) > windowDays) {
        continue;
      }
      if (
        subscription.lastRemindedFor &&
        isoDate(subscription.lastRemindedFor) === expected
      ) {
        continue;
      }
      const eventId = `finance-subscription-renewal:${subscription.id}:${expected}`;
      if (!(await this.outbox.hasEvent(eventId))) {
        await this.events.enqueue({
          eventId,
          eventName: AppEvents.FINANCE_SUBSCRIPTION_RENEWAL_DUE,
          aggregateType: AGGREGATE_TYPE,
          aggregateId: subscription.id,
          userId,
          payload: {
            subscriptionId: subscription.id,
            name: subscription.name,
            amount: scalarNumber(subscription.amount),
            currency: subscription.currency,
            nextBillingDate: expected,
            daysUntil: daysUntil(subscription.nextBillingDate, today),
          },
        });
      }
      await this.repo.update(userId, subscription.id, {
        lastRemindedFor: subscription.nextBillingDate,
      });
    }
    void this.dispatcher.processBatch();
  }
}
