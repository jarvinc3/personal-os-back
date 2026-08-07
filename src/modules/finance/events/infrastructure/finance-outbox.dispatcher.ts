import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../../prisma/prisma.service';

const MAX_ATTEMPTS = 8;
const BATCH_SIZE = 20;

@Injectable()
export class FinanceOutboxDispatcher {
  private readonly logger = new Logger(FinanceOutboxDispatcher.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async handleCron(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.processBatch();
    } finally {
      this.running = false;
    }
  }

  /** Exposed for tests and wake-after-commit. */
  async processBatch(): Promise<number> {
    let processed = 0;
    for (let i = 0; i < BATCH_SIZE; i += 1) {
      const claimed = await this.claimNext();
      if (!claimed) break;
      await this.dispatch(claimed);
      processed += 1;
    }
    return processed;
  }

  private async claimNext() {
    const now = new Date();
    const pending = await this.prisma.domainEventOutbox.findFirst({
      where: {
        status: { in: ['PENDING', 'FAILED'] },
        nextAttemptAt: { lte: now },
        attempts: { lt: MAX_ATTEMPTS },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!pending) return null;

    const result = await this.prisma.domainEventOutbox.updateMany({
      where: {
        id: pending.id,
        status: { in: ['PENDING', 'FAILED'] },
        attempts: pending.attempts,
      },
      data: {
        status: 'PROCESSING',
        attempts: pending.attempts + 1,
      },
    });
    if (result.count === 0) return null;
    return this.prisma.domainEventOutbox.findUnique({ where: { id: pending.id } });
  }

  private async dispatch(
    row: NonNullable<Awaited<ReturnType<PrismaService['domainEventOutbox']['findUnique']>>>,
  ): Promise<void> {
    try {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      await this.eventEmitter.emitAsync(row.eventName, {
        eventId: row.eventId,
        userId: row.userId,
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        ...payload,
      });

      await this.prisma.domainEventOutbox.update({
        where: { id: row.id },
        data: {
          status: 'COMPLETED',
          processedAt: new Date(),
          lastError: null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempts = row.attempts;
      const terminal = attempts >= MAX_ATTEMPTS;
      const minutes = Math.min(60, 2 ** Math.max(0, attempts - 1));
      await this.prisma.domainEventOutbox.update({
        where: { id: row.id },
        data: {
          status: terminal ? 'DEAD' : 'FAILED',
          lastError: message.slice(0, 2000),
          nextAttemptAt: new Date(Date.now() + minutes * 60_000),
        },
      });
      this.logger.warn(
        `outbox ${terminal ? 'dead' : 'retry'} event=${row.eventName} id=${row.eventId}: ${message}`,
      );
    }
  }
}
