import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Env } from '@personal-os/config';
import { PrismaService } from '@personal-os/database';

@Injectable()
export class AiEmailRetentionScheduler {
  private readonly logger = new Logger(AiEmailRetentionScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async purgeExpiredRawContent(): Promise<void> {
    const nodeEnv = this.config.get('NODE_ENV', { infer: true });
    const retentionDays = nodeEnv === 'production' ? 7 : 30;
    const cutoff = new Date(Date.now() - retentionDays * 86400_000);
    const result = await this.prisma.aiEmailMessageContent.updateMany({
      where: {
        rawBody: { not: null },
        OR: [
          { retentionExpiresAt: { lte: new Date() } },
          {
            retentionExpiresAt: null,
            message: { receivedAt: { lte: cutoff } },
          },
        ],
      },
      data: { rawBody: null, retentionExpiresAt: null },
    });
    if (result.count) {
      this.logger.log(
        `Purged raw content from ${result.count} AI email messages`,
      );
    }
  }
}
