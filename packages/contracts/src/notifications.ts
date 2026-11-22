import type { DomainEvent } from './domain-events';
import type { IsoInstant, JsonObject } from './primitives';

export const NOTIFICATION_INTENT_SINK = Symbol.for(
  'personal-os.contracts.notification-intent-sink',
);
export const NOTIFICATION_INTENT_CONSUMER = Symbol.for(
  'personal-os.contracts.notification-intent-consumer',
);

export interface NotificationIntent {
  schemaVersion: 1;
  userId: string;
  sourceDomain: string;
  type: string;
  preferenceKey?: string;
  title: string;
  body: string;
  data?: JsonObject;
  requestedChannels: readonly ('IN_APP' | 'PUSH' | 'EMAIL')[];
  deduplicationKey: string;
  occurredAt: IsoInstant;
  cause?: { eventId: string; eventName: string };
}
export interface IntentProducer<TEvent = DomainEvent> {
  toIntents(event: TEvent): readonly NotificationIntent[];
}
export interface NotificationIntentSink {
  submit(
    intent: NotificationIntent,
  ): Promise<{ accepted: boolean; notificationIds: readonly string[] }>;
}
export interface NotificationIntentConsumer {
  accept(input: unknown): NotificationIntent;
}
