import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, PrismaService } from '@personal-os/database';

/** Payloads older than this are cleared; the row itself is kept. */
export const EMAIL_PAYLOAD_RETENTION_DAYS = 30;
/** Rows per round, so a large backlog never runs in a single long query. */
export const RETENTION_BATCH_SIZE = 1_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Chain-of-thought payloads from the email extractor are only needed while a
 * message can still be reprocessed. After 30 days the row stays (dedup by
 * gmailMessageId/fingerprint keeps working) but `extracted_payload` is set to
 * NULL. Transactions are never touched. Idempotent: already-cleared rows no
 * longer match the filter.
 */
@Injectable()
export class EmailMessageRetentionScheduler {
  private readonly logger = new Logger(EmailMessageRetentionScheduler.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgeExpiredPayloads(): Promise<void> {
    const purged = await this.purgeBatches(new Date());
    if (purged > 0) {
      this.logger.log(`Cleared ${purged} expired email extracted payloads`);
    }
  }

  private async purgeBatches(now: Date): Promise<number> {
    const cutoff = new Date(
      now.getTime() - EMAIL_PAYLOAD_RETENTION_DAYS * DAY_MS,
    );
    let purged = 0;
    for (;;) {
      const cleared = await this.clearBatch(cutoff);
      purged += cleared;
      if (cleared < RETENTION_BATCH_SIZE) {
        return purged;
      }
    }
  }

  private async clearBatch(cutoff: Date): Promise<number> {
    const expired = await this.prisma.finEmailMessage.findMany({
      where: {
        createdAt: { lt: cutoff },
        extractedPayload: { not: Prisma.DbNull },
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: RETENTION_BATCH_SIZE,
    });
    if (expired.length === 0) {
      return 0;
    }
    const { count } = await this.prisma.finEmailMessage.updateMany({
      where: { id: { in: expired.map((row) => row.id) } },
      data: { extractedPayload: Prisma.DbNull },
    });
    return count;
  }
}
