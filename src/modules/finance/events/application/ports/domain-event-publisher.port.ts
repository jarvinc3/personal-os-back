export type DomainEventEnvelope = {
  eventId: string;
  eventName: string;
  aggregateType: string;
  aggregateId: string;
  userId: string | null;
  occurredAt: string;
  version: number;
  payload: Record<string, unknown>;
};

export interface DomainEventPublisherPort {
  /**
   * Enqueue an event inside an open Prisma transaction client when provided.
   * After commit, the outbox dispatcher delivers to EventEmitter / consumers.
   */
  enqueue(
    event: Omit<DomainEventEnvelope, 'eventId' | 'occurredAt' | 'version'> & {
      eventId?: string;
      occurredAt?: string;
      version?: number;
    },
    tx?: unknown,
  ): Promise<DomainEventEnvelope>;
}
