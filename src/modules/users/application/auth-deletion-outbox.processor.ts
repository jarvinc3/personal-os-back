import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseAdminService } from '../../auth/infrastructure/supabase-admin.service';
import { UsersRepository } from '../infrastructure/users.repository';

const MAX_ATTEMPTS = 8;
const BATCH_SIZE = 10;

@Injectable()
export class AuthDeletionOutboxProcessor {
  private readonly logger = new Logger(AuthDeletionOutboxProcessor.name);
  private running = false;

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly supabaseAdminService: SupabaseAdminService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await this.processBatch();
    } finally {
      this.running = false;
    }
  }

  /** Exposed for tests. */
  async processBatch(): Promise<number> {
    let processed = 0;
    for (let i = 0; i < BATCH_SIZE; i += 1) {
      const claimed = await this.usersRepository.claimNextAuthDeletion(
        MAX_ATTEMPTS,
      );
      if (!claimed) {
        break;
      }
      await this.processClaim(claimed);
      processed += 1;
    }
    return processed;
  }

  private async processClaim(claimed: {
    id: string;
    userId: string;
    attempts: number;
  }): Promise<void> {
    const nextAttempts = claimed.attempts + 1;
    const result = await this.supabaseAdminService.tryDeleteAuthUser(
      claimed.userId,
    );

    if (result.ok) {
      await this.usersRepository.completeAuthDeletion(claimed.id);
      this.logger.log(
        `auth_deletion_outbox completed userId=${claimed.userId} attempts=${nextAttempts}`,
      );
      return;
    }

    const terminal = nextAttempts >= MAX_ATTEMPTS || !result.retryable;
    const nextAttemptAt = this.computeNextAttemptAt(nextAttempts);
    await this.usersRepository.failAuthDeletion(
      claimed.id,
      nextAttempts,
      result.message,
      nextAttemptAt,
      terminal,
    );

    this.logger.warn(
      `auth_deletion_outbox ${terminal ? 'dead' : 'retry'} userId=${claimed.userId} attempts=${nextAttempts} message=${result.message}`,
    );
  }

  private computeNextAttemptAt(attempts: number): Date {
    // Exponential backoff: 1m, 2m, 4m, ... capped at 1h.
    const minutes = Math.min(60, 2 ** Math.max(0, attempts - 1));
    return new Date(Date.now() + minutes * 60_000);
  }
}
