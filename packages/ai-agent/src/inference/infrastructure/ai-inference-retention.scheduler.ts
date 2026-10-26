import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@personal-os/database';

const PURGE_BATCH_SIZE = 1_000;

@Injectable()
export class AiInferenceRetentionScheduler {
  private readonly logger = new Logger(AiInferenceRetentionScheduler.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeExpired(now = new Date()): Promise<number> {
    let purged = 0;
    for (;;) {
      const expired = await this.prisma.aiInference.findMany({
        where: { expiresAt: { lte: now } },
        select: { id: true },
        take: PURGE_BATCH_SIZE,
      });
      if (expired.length === 0) {
        break;
      }
      const { count } = await this.prisma.aiInference.deleteMany({
        where: { id: { in: expired.map((row) => row.id) } },
      });
      purged += count;
      if (expired.length < PURGE_BATCH_SIZE) {
        break;
      }
    }
    if (purged > 0) {
      this.logger.log(`Purged ${purged} expired AI inference telemetry rows`);
    }
    return purged;
  }
}
