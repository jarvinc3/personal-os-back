import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CardPaymentRemindersService } from '../application/card-payment-reminders.service';
import { CardStatementsRepository } from './card-statements.repository';

/** Nightly sweep: heads-up before a closed card statement payment is due. */
@Injectable()
export class CardPaymentRemindersScheduler {
  private readonly logger = new Logger(CardPaymentRemindersScheduler.name);
  private running = false;

  constructor(
    private readonly repo: CardStatementsRepository,
    private readonly reminders: CardPaymentRemindersService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_7AM)
  async handleCron(now: Date = new Date()): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const userIds = await this.repo.listUserIdsWithActiveCreditCards();
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `card_payment_sweep_failed userId=${userId}: ${message}`,
      );
    }
  }
}
