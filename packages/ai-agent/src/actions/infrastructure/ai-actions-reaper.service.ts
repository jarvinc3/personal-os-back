import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AiActionsRepository } from './ai-actions.repository';

const RUNNING_ACTION_TIMEOUT_MS = 15 * 60 * 1000;

@Injectable()
export class AiActionsReaperService {
  private readonly logger = new Logger(AiActionsReaperService.name);

  constructor(private readonly actions: AiActionsRepository) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async failStaleRunning(now = new Date()): Promise<number> {
    const failed = await this.actions.failStaleRunning(
      new Date(now.getTime() - RUNNING_ACTION_TIMEOUT_MS),
    );
    if (failed > 0) {
      this.logger.warn(`Marked ${failed} stale AI actions as failed`);
    }
    return failed;
  }
}
