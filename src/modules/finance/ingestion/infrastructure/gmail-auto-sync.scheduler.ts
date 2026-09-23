import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EnqueueDueGmailSyncsUseCase } from '../application/enqueue-due-gmail-syncs.use-case';

@Injectable()
export class GmailAutoSyncScheduler implements OnModuleInit {
  private readonly logger = new Logger(GmailAutoSyncScheduler.name);

  constructor(private readonly enqueueDue: EnqueueDueGmailSyncsUseCase) {}

  onModuleInit(): void {
    void this.enqueueDue.execute().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`Startup Gmail auto-sync failed: ${message}`);
    });
  }

  @Cron(CronExpression.EVERY_6_HOURS)
  handleCron(): Promise<{ queued: number; skipped: number }> {
    return this.enqueueDue.execute();
  }
}
