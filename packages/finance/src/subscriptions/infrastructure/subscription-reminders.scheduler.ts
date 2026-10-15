import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SubscriptionRemindersService } from '../application/subscription-reminders.service';
import { SubscriptionsService } from '../application/subscriptions.service';
import { SubscriptionsRepository } from './subscriptions.repository';

const MATCH_LOOKBACK_DAYS = 35;
const MS_PER_DAY = 86_400_000;

/** Nightly sweep: sends renewal reminders and matches missed charges. */
@Injectable()
export class SubscriptionRemindersScheduler {
  private readonly logger = new Logger(SubscriptionRemindersScheduler.name);
  private running = false;

  constructor(
    private readonly repo: SubscriptionsRepository,
    private readonly reminders: SubscriptionRemindersService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async handleCron(now: Date = new Date()): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const userIds = await this.repo.listUserIdsWithActive();
      for (const userId of userIds) {
        await this.runForUser(userId, now);
      }
    } finally {
      this.running = false;
    }
  }

  async runForUser(userId: string, now: Date): Promise<void> {
    try {
      await this.reminders.evaluate(userId, now);
      const since = new Date(now.getTime() - MATCH_LOOKBACK_DAYS * MS_PER_DAY);
      const pending = await this.repo.listUnmatchedRecentTransactions(
        userId,
        since,
      );
      for (const transactionId of pending) {
        await this.subscriptions.matchTransaction({ userId, transactionId });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `subscription_sweep_failed userId=${userId}: ${message}`,
      );
    }
  }
}
