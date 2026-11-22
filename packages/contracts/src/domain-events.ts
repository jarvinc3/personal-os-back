import type { IsoInstant, JsonObject } from './primitives';

export const DOMAIN_EVENT_PUBLISHER = Symbol.for(
  'personal-os.contracts.domain-event-publisher',
);
export const DOMAIN_EVENT_RELAY = Symbol.for(
  'personal-os.contracts.domain-event-relay',
);
export const DOMAIN_EVENT_OUTBOX_READER = Symbol.for(
  'personal-os.contracts.domain-event-outbox-reader',
);

export interface DomainEvent<T extends JsonObject = JsonObject> {
  eventId: string;
  eventName: string;
  version: number;
  occurredAt: IsoInstant;
  userId: string | null;
  aggregateType: string;
  aggregateId: string;
  payload: T;
}
/**
 * Event a producer hands to the shared outbox. The infrastructure fills the
 * identity fields (`eventId`, `occurredAt`, `version`) when the domain does not
 * fix them.
 */
export type DomainEventDraft = {
  eventName: string;
  userId: string | null;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
} & Partial<Pick<DomainEvent, 'eventId' | 'occurredAt' | 'version'>>;
// The infrastructure supplies its transaction type; contracts never import it.
export interface DomainEventPublisher {
  /** Writes the event inside the caller's transaction when one is provided. */
  enqueue(draft: DomainEventDraft, tx?: unknown): Promise<void>;
}
/** Delivers pending outbox rows now; the periodic relay covers failures. */
export interface DomainEventRelay {
  wake(): Promise<void>;
}
export interface DomainEventOutboxReader {
  hasEvent(eventId: string): Promise<boolean>;
}
