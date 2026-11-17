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
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { mergeWithDefaults, UsersService } from '@personal-os/users';
import {
  FINANCE_NOTIFICATION_KEYS,
  FINANCE_SETTINGS_DEFAULTS,
} from '../../settings/finance-settings';
import {
  WeeklySummaryService,
  previousWeekStartIso,
} from '../application/weekly-summary.service';

const SEND_HOUR = 8;
const FINANCE_MODULE_SLUG = 'finance';
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
    private readonly events: DomainEventPublisher,
    @Inject(DOMAIN_EVENT_OUTBOX_READER)
    private readonly outbox: DomainEventOutboxReader,
    @Inject(DOMAIN_EVENT_RELAY)
    private readonly relay: DomainEventRelay,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron(now: Date = new Date()): Promise<void> {
    const moduleConfigs =
      await this.users.listEnabledModuleConfigs(FINANCE_MODULE_SLUG);
    for (const moduleConfig of moduleConfigs) {
      const recipient = this.resolveRecipient(moduleConfig);
      if (!recipient) {
        continue;
      }
      const local = localDayAndHour(recipient.timezone, now);
      if (local.day !== recipient.day || local.hour !== SEND_HOUR) {
        continue;
      }
      await this.emitSummary(recipient.userId, local.dateIso);
    }
  }

  /** Finance decides who receives its summary and on which weekday. */
  private resolveRecipient(moduleConfig: {
    userId: string;
    timezone: string;
    config: unknown;
  }): { userId: string; timezone: string; day: number } | null {
    const config = mergeWithDefaults(
      moduleConfig.config,
      FINANCE_SETTINGS_DEFAULTS as unknown as Record<string, unknown>,
    );
    const notifications = (config.notifications ?? {}) as Record<
      string,
      boolean
    >;
    if (notifications[FINANCE_NOTIFICATION_KEYS.weeklySummary] === false) {
      return null;
    }
    const reports = (config.reports ?? {}) as { weeklySummaryDay?: unknown };
    const day =
      typeof reports.weeklySummaryDay === 'number'
        ? reports.weeklySummaryDay
        : FINANCE_SETTINGS_DEFAULTS.reports.weeklySummaryDay;
    return {
      userId: moduleConfig.userId,
      timezone: moduleConfig.timezone,
      day,
    };
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
      void this.relay.wake();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`weekly_summary_failed userId=${userId}: ${message}`);
    }
  }
}
