import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BalanceIntegrityService } from '../application/balance-integrity.service';
import { IntegrityRepository } from '../infrastructure/integrity.repository';

/** Nightly sweep: detects every open balance deviation and notifies it. */
@Injectable()
export class BalanceIntegrityScheduler {
  private readonly logger = new Logger(BalanceIntegrityScheduler.name);
  private running = false;

  constructor(
    private readonly repo: IntegrityRepository,
    private readonly integrity: BalanceIntegrityService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async handleCron(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const userIds = await this.repo.listUserIdsWithProducts();
      for (const userId of userIds) {
        try {
          await this.integrity.runForUser(userId);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `balance_integrity_failed userId=${userId}: ${message}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }
}
