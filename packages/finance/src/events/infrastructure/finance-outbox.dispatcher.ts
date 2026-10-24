import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@personal-os/database';

const MAX_ATTEMPTS = 8;
const BATCH_SIZE = 20;
const LEASE_MS = 5 * 60_000;

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

  /** Exposed for tests and wake-after-commit. */
  async processBatch(): Promise<number> {
    await this.recoverExpiredLeases();
    let processed = 0;
    for (let i = 0; i < BATCH_SIZE; i += 1) {
      const claimed = await this.claimNext();
      if (!claimed) {
        break;
      }
      await this.dispatch(claimed);
      processed += 1;
    }
    return processed;
  }

  private async recoverExpiredLeases(): Promise<void> {
    const expired = {
      status: 'PROCESSING' as const,
      OR: [
        { claimedAt: { lte: new Date(Date.now() - LEASE_MS) } },
        // Rows claimed by a pre-lease deployment are also recoverable.
        { claimedAt: null },
      ],
    };
    await this.prisma.domainEventOutbox.updateMany({
      where: { ...expired, attempts: { gte: MAX_ATTEMPTS } },
      data: {
        status: 'DEAD',
        claimedAt: null,
        lastError: 'Delivery lease expired after final attempt',
      },
    });
    await this.prisma.domainEventOutbox.updateMany({
      where: { ...expired, attempts: { lt: MAX_ATTEMPTS } },
      data: {
        status: 'PENDING',
        claimedAt: null,
        nextAttemptAt: new Date(),
        lastError: 'Delivery lease expired; retry scheduled',
      },
    });
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
    if (!pending) {
      return null;
    }

    const result = await this.prisma.domainEventOutbox.updateMany({
      where: {
        id: pending.id,
        status: { in: ['PENDING', 'FAILED'] },
        attempts: pending.attempts,
      },
      data: {
        status: 'PROCESSING',
        attempts: pending.attempts + 1,
        claimedAt: now,
      },
    });
    if (result.count === 0) {
      return null;
    }
    // attempts is a monotonic fencing token. Never re-read another worker's
    // newer claim and accidentally acknowledge it as our own.
    return { ...pending, attempts: pending.attempts + 1, claimedAt: now };
  }

  private async dispatch(
    row: NonNullable<
      Awaited<ReturnType<PrismaService['domainEventOutbox']['findUnique']>>
    >,
  ): Promise<void> {
    try {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      await this.eventEmitter.emitAsync(row.eventName, {
        ...payload,
        eventId: row.eventId,
        userId: row.userId,
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
      });

      await this.prisma.domainEventOutbox.updateMany({
        where: {
          id: row.id,
          status: 'PROCESSING',
          attempts: row.attempts,
          claimedAt: row.claimedAt,
        },
        data: {
          status: 'COMPLETED',
          processedAt: new Date(),
          lastError: null,
          claimedAt: null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempts = row.attempts;
      const terminal = attempts >= MAX_ATTEMPTS;
      const minutes = Math.min(60, 2 ** Math.max(0, attempts - 1));
      const failed = await this.prisma.domainEventOutbox.updateMany({
        where: {
          id: row.id,
          status: 'PROCESSING',
          attempts: row.attempts,
          claimedAt: row.claimedAt,
        },
        data: {
          status: terminal ? 'DEAD' : 'FAILED',
          lastError: message.slice(0, 2000),
          nextAttemptAt: new Date(Date.now() + minutes * 60_000),
          claimedAt: null,
        },
      });
      if (failed.count > 0) {
        this.logger.warn(
          `outbox ${terminal ? 'dead' : 'retry'} event=${row.eventName} id=${row.eventId}: ${message}`,
        );
      }
    }
  }
}
