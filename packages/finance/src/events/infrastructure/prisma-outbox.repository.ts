import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Prisma } from '@personal-os/database';
import { PrismaService } from '@personal-os/database';
import type {
  DomainEventEnvelope,
  DomainEventPublisherPort,
} from '../application/ports/domain-event-publisher.port';

type TxClient = Prisma.TransactionClient;

@Injectable()
export class PrismaOutboxRepository implements DomainEventPublisherPort {
  constructor(private readonly prisma: PrismaService) {}

  async enqueue(
    event: Omit<DomainEventEnvelope, 'eventId' | 'occurredAt' | 'version'> & {
      eventId?: string;
      occurredAt?: string;
      version?: number;
    },
    tx?: unknown,
  ): Promise<DomainEventEnvelope> {
    const envelope: DomainEventEnvelope = {
      eventId: event.eventId ?? randomUUID(),
      eventName: event.eventName,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      userId: event.userId,
      occurredAt: event.occurredAt ?? new Date().toISOString(),
      version: event.version ?? 1,
      payload: event.payload,
    };

    const client = (tx as TxClient | undefined) ?? this.prisma;
    await client.domainEventOutbox.create({
      data: {
        eventId: envelope.eventId,
        eventName: envelope.eventName,
        aggregateType: envelope.aggregateType,
        aggregateId: envelope.aggregateId,
        userId: envelope.userId,
        payload: {
          ...envelope.payload,
          occurredAt: envelope.occurredAt,
          version: envelope.version,
        },
      },
    });

    return envelope;
  }

  async hasEvent(eventId: string): Promise<boolean> {
    const row = await this.prisma.domainEventOutbox.findUnique({
      where: { eventId },
      select: { id: true },
    });
    return row !== null;
  }
}
