import { Injectable } from '@nestjs/common';
import { PrismaService, type Prisma } from '@personal-os/database';

/**
 * Commits the receipt and PostgreSQL effects together. A failed/crashed
 * transaction leaves neither a receipt nor a partially applied effect.
 */
@Injectable()
export class DomainEventIdempotencyGuard {
  constructor(private readonly prisma: PrismaService) {}

  async runOnce<T>(
    eventId: string | undefined,
    consumer: string,
    effect: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T | undefined> {
    return this.prisma.$transaction(async (tx) => {
      if (eventId && !(await this.claim(tx, eventId, consumer))) {
        return undefined;
      }
      return effect(tx);
    });
  }

  /**
   * Receipt write inside an already open transaction. `ON CONFLICT` waits for
   * an in-flight transaction: if it rolls back, this insert succeeds; if it
   * commits, the duplicate is skipped.
   */
  async claim(
    tx: Prisma.TransactionClient,
    eventId: string,
    consumer: string,
  ): Promise<boolean> {
    const receipt = await tx.processedDomainEvent.createMany({
      data: { eventId, consumer },
      skipDuplicates: true,
    });
    return receipt.count > 0;
  }

  /** Event id a lookup consumer recorded, or null when there is no receipt. */
  async findReceiptEventId(consumer: string): Promise<string | null> {
    const receipt = await this.prisma.processedDomainEvent.findFirst({
      where: { consumer },
      select: { eventId: true },
    });
    return receipt?.eventId ?? null;
  }

  async wasProcessed(eventId: string, consumer: string): Promise<boolean> {
    return Boolean(
      await this.prisma.processedDomainEvent.findUnique({
        where: { eventId_consumer: { eventId, consumer } },
        select: { id: true },
      }),
    );
  }

  /** Effect-free receipt write; an external handoff must already be durable. */
  async tryClaim(
    eventId: string | undefined,
    consumer: string,
  ): Promise<boolean> {
    return (
      (await this.runOnce(eventId, consumer, () => Promise.resolve(true))) ===
      true
    );
  }
}
