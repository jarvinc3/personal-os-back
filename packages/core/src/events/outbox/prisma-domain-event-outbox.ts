import { Injectable } from '@nestjs/common';
import type {
  DomainEventDraft,
  DomainEventOutboxReader,
  DomainEventPublisher,
} from '@personal-os/contracts';
import { randomUUID } from 'crypto';
import type { Prisma } from '@personal-os/database';
import { PrismaService } from '@personal-os/database';

type TxClient = Prisma.TransactionClient;

/**
 * Durable outbox write shared by every domain, plus the lookup that lets a
 * scheduled producer keep a stable event id across runs.
 */
@Injectable()
export class PrismaDomainEventOutbox
  implements DomainEventPublisher, DomainEventOutboxReader
{
  constructor(private readonly prisma: PrismaService) {}

  async enqueue(draft: DomainEventDraft, tx?: unknown): Promise<void> {
    const client = (tx as TxClient | undefined) ?? this.prisma;
    await client.domainEventOutbox.create({
      data: {
        eventId: draft.eventId ?? randomUUID(),
        eventName: draft.eventName,
        aggregateType: draft.aggregateType,
        aggregateId: draft.aggregateId,
        userId: draft.userId,
        payload: {
          ...draft.payload,
          occurredAt: draft.occurredAt ?? new Date().toISOString(),
          version: draft.version ?? 1,
        },
      },
    });
  }

  async hasEvent(eventId: string): Promise<boolean> {
    const row = await this.prisma.domainEventOutbox.findUnique({
      where: { eventId },
      select: { id: true },
    });
    return row !== null;
  }
}
