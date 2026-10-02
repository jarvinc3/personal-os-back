import { Injectable } from '@nestjs/common';
import { PrismaService } from '@personal-os/database';

/**
 * Ensures domain event consumers process each (eventId, consumer) at most once.
 */
@Injectable()
export class DomainEventIdempotencyGuard {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * @returns true if this consumer should process the event (claimed successfully)
   */
  async tryClaim(
    eventId: string | undefined,
    consumer: string,
  ): Promise<boolean> {
    if (!eventId) {
      // Without eventId we cannot de-duplicate; process once (in-process fanout).
      return true;
    }
    try {
      await this.prisma.processedDomainEvent.create({
        data: { eventId, consumer },
      });
      return true;
    } catch {
      const existing = await this.prisma.processedDomainEvent.findUnique({
        where: {
          eventId_consumer: { eventId, consumer },
        },
      });
      return !existing;
    }
  }
}
