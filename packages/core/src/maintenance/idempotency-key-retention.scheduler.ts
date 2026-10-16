import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@personal-os/database';

/** Rows per round, so a large backlog never runs in a single long query. */
export const PURGE_BATCH_SIZE = 1_000;

/**
 * Expired keys are otherwise only removed when they are reused, so the table
 * grows without bound. The TTL already guarantees that an expired key is never
 * needed again, so the daily purge can delete them in batches.
 */
@Injectable()
export class IdempotencyKeyRetentionScheduler {
  private readonly logger = new Logger(IdempotencyKeyRetentionScheduler.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeExpired(): Promise<void> {
    const purged = await this.purgeExpiredBatches(new Date());
    if (purged > 0) {
      this.logger.log(`Purged ${purged} expired idempotency keys`);
    }
  }

  private async purgeExpiredBatches(now: Date): Promise<number> {
    let purged = 0;
    for (;;) {
      const deleted = await this.deleteExpiredBatch(now);
      purged += deleted;
      if (deleted < PURGE_BATCH_SIZE) {
        return purged;
      }
    }
  }

  private async deleteExpiredBatch(now: Date): Promise<number> {
    const expired = await this.prisma.idempotencyKey.findMany({
      where: { expiresAt: { lt: now } },
      select: { id: true },
      take: PURGE_BATCH_SIZE,
    });
    if (expired.length === 0) {
      return 0;
    }
    const { count } = await this.prisma.idempotencyKey.deleteMany({
      where: { id: { in: expired.map((row) => row.id) } },
    });
    return count;
  }
}
