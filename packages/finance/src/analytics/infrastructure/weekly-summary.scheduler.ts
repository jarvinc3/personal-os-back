import { FinanceEvents } from '../../contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { UsersService } from '@personal-os/users';
import { FinanceOutboxDispatcher } from '../../events/infrastructure/finance-outbox.dispatcher';
import { PrismaOutboxRepository } from '../../events/infrastructure/prisma-outbox.repository';
import { DOMAIN_EVENT_PUBLISHER } from '../../shared/application/tokens';
import type { DomainEventPublisherPort } from '../../events/application/ports/domain-event-publisher.port';
import {
  WeeklySummaryService,
  previousWeekStartIso,
} from '../application/weekly-summary.service';

const SEND_HOUR = 8;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const CONSUMER_AGGREGATE = 'User';

function localDayAndHour(
  timezone: string | null,
  now: Date,
): { day: number; hour: number; dateIso: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone ?? 'UTC',
    weekday: 'short',
    hour: '2-digit',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const valueOf = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '';
  const hour = Number(valueOf('hour'));
  return {
    day: WEEKDAYS.indexOf(valueOf('weekday') as (typeof WEEKDAYS)[number]),
    hour: hour === 24 ? 0 : hour,
    dateIso: `${valueOf('year')}-${valueOf('month')}-${valueOf('day')}`,
  };
}

@Injectable()
export class WeeklySummaryScheduler {
  private readonly logger = new Logger(WeeklySummaryScheduler.name);

  constructor(
    private readonly users: UsersService,
    private readonly summaries: WeeklySummaryService,
    @Inject(DOMAIN_EVENT_PUBLISHER)
    private readonly events: DomainEventPublisherPort,
    private readonly outbox: PrismaOutboxRepository,
    private readonly outboxDispatcher: FinanceOutboxDispatcher,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron(now: Date = new Date()): Promise<void> {
    const recipients = await this.users.listWeeklySummaryRecipients();
    for (const recipient of recipients) {
      const local = localDayAndHour(recipient.timezone, now);
      if (local.day !== recipient.day || local.hour !== SEND_HOUR) {
        continue;
      }
      await this.emitSummary(recipient.userId, local.dateIso);
    }
  }

  private async emitSummary(userId: string, dateIso: string): Promise<void> {
    const weekStart = previousWeekStartIso(dateIso);
    const eventId = `finance-weekly-summary:${userId}:${weekStart}`;
    if (await this.outbox.hasEvent(eventId)) {
      return;
    }
    try {
      const summary = await this.summaries.build(userId, weekStart);
      await this.events.enqueue({
        eventId,
        eventName: FinanceEvents.WEEKLY_SUMMARY,
        aggregateType: CONSUMER_AGGREGATE,
        aggregateId: userId,
        userId,
        payload: { weekStart, summary },
      });
      void this.outboxDispatcher.processBatch();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`weekly_summary_failed userId=${userId}: ${message}`);
    }
  }
}
