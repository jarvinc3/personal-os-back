import type { JsonObject, NotificationIntent } from '@personal-os/contracts';
import type { FinanceDomainEvent } from '../contracts';
import type { NotificationCopy } from './finance-notification-copy';

/** Domain that owns the notice; Notifications only delivers it. */
const SOURCE_DOMAIN = 'finance';
/** Slug the notice carries for the module settings screen. */
export const FINANCE_MODULE_SLUG = 'finance';
const IN_APP_ONLY = ['IN_APP'] as const;

export type FinanceIntentInput = {
  event: FinanceDomainEvent;
  userId: string;
  type: string;
  copy: NotificationCopy;
  data: JsonObject;
  preferenceKey?: string;
  /** Overrides the event id as the stable identity of the notice. */
  identity?: string;
};

/**
 * Neutral notice Finance hands to Notifications: copy, preference and the
 * deduplication identity belong here; delivery does not.
 */
export function buildFinanceIntent(
  input: FinanceIntentInput,
): NotificationIntent {
  const identity = input.identity ?? input.event.eventId;
  return {
    schemaVersion: 1,
    userId: input.userId,
    sourceDomain: SOURCE_DOMAIN,
    type: input.type,
    ...(input.preferenceKey === undefined
      ? {}
      : { preferenceKey: input.preferenceKey }),
    title: input.copy.title,
    body: input.copy.body,
    data: input.data,
    requestedChannels: [...IN_APP_ONLY],
    deduplicationKey: `${SOURCE_DOMAIN}:${input.type}:${identity}`,
    occurredAt: input.event.occurredAt,
    cause: {
      eventId: input.event.eventId,
      eventName: input.event.eventName,
    },
  };
}
