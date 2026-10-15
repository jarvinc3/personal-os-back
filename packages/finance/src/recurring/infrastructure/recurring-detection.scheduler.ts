import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RecurringAlertsService } from '../application/recurring-alerts.service';
import {
  DETECTION_LOOKBACK_DAYS,
  RecurringService,
} from '../application/recurring.service';
import { RecurringRepository } from './recurring.repository';

const MS_PER_DAY = 86_400_000;

/** Nightly sweep: detects patterns and raises the recurring alerts. */
@Injectable()
export class RecurringDetectionScheduler {
  private readonly logger = new Logger(RecurringDetectionScheduler.name);
  private running = false;

  constructor(
    private readonly repo: RecurringRepository,
    private readonly recurring: RecurringService,
    private readonly alerts: RecurringAlertsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleCron(now: Date = new Date()): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const since = new Date(
        now.getTime() - DETECTION_LOOKBACK_DAYS * MS_PER_DAY,
      );
      const userIds = await this.repo.listCandidateUserIds(since);
      for (const userId of userIds) {
        await this.runForUser(userId, now);
      }
    } finally {
      this.running = false;
    }
  }

  async runForUser(userId: string, now: Date): Promise<void> {
    try {
      const outcome = await this.recurring.detect(userId, now);
      await this.alerts.evaluate(userId, outcome, now);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `recurring_detection_failed userId=${userId}: ${message}`,
      );
    }
  }
}
