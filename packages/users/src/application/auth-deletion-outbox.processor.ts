import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseAdminService } from '@personal-os/auth';
import {
  USERS_REPOSITORY,
  type UsersRepositoryPort,
} from './ports/users.repository.port';

const MAX_ATTEMPTS = 8;
const BATCH_SIZE = 10;

@Injectable()
export class AuthDeletionOutboxProcessor {
  private readonly logger = new Logger(AuthDeletionOutboxProcessor.name);
  private running = false;

  constructor(
    @Inject(USERS_REPOSITORY)
    private readonly usersRepository: UsersRepositoryPort,
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
    await this.usersRepository.recoverExpiredAuthDeletions(MAX_ATTEMPTS);
    let processed = 0;
    for (let i = 0; i < BATCH_SIZE; i += 1) {
      const claimed =
        await this.usersRepository.claimNextAuthDeletion(MAX_ATTEMPTS);
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
    const result = await this.supabaseAdminService.tryDeleteAuthUser(
      claimed.userId,
    );

    if (result.ok) {
      const completed = await this.usersRepository.completeAuthDeletion(
        claimed.id,
        claimed.attempts,
      );
      if (completed.count === 0) {
        this.logger.warn(
          `auth_deletion_outbox lease lost userId=${claimed.userId} attempts=${claimed.attempts}`,
        );
        return;
      }
      this.logger.log(
        `auth_deletion_outbox completed userId=${claimed.userId} attempts=${claimed.attempts}`,
      );
      return;
    }

    const terminal = claimed.attempts >= MAX_ATTEMPTS || !result.retryable;
    const nextAttemptAt = this.computeNextAttemptAt(claimed.attempts);
    const failed = await this.usersRepository.failAuthDeletion({
      id: claimed.id,
      attempts: claimed.attempts,
      lastError: result.message,
      nextAttemptAt,
      terminal,
    });
    if (failed.count === 0) {
      this.logger.warn(
        `auth_deletion_outbox lease lost userId=${claimed.userId} attempts=${claimed.attempts}`,
      );
      return;
    }

    this.logger.warn(
      `auth_deletion_outbox ${terminal ? 'dead' : 'retry'} userId=${claimed.userId} attempts=${claimed.attempts} message=${result.message}`,
    );
  }

  private computeNextAttemptAt(attempts: number): Date {
    // Exponential backoff: 1m, 2m, 4m, ... capped at 1h.
    const minutes = Math.min(60, 2 ** Math.max(0, attempts - 1));
    return new Date(Date.now() + minutes * 60_000);
  }
}
