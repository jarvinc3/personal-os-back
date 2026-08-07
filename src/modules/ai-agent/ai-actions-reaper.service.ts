import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AiActionsRepository } from './ai-actions.repository';

const STALE_RUNNING_MINUTES = 15;

@Injectable()
export class AiActionsReaperService {
  private readonly logger = new Logger(AiActionsReaperService.name);

  constructor(private readonly actionsRepo: AiActionsRepository) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async reapStaleRunningActions(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_RUNNING_MINUTES * 60_000);
    const count = await this.actionsRepo.failStaleRunning(cutoff);
    if (count > 0) {
      this.logger.warn(`Reaped ${count} stale RUNNING AiAction(s)`);
    }
  }
}
