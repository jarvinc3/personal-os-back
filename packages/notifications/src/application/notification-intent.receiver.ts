import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  IsoInstant,
  JsonObject,
  NotificationIntent,
  NotificationIntentConsumer,
} from '@personal-os/contracts';

const NOTIFICATION_CHANNELS = new Set<string>(['IN_APP', 'PUSH', 'EMAIL']);

const REQUIRED_STRING_FIELDS = [
  'userId',
  'sourceDomain',
  'type',
  'title',
  'body',
  'deduplicationKey',
  'occurredAt',
] as const;

const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isJsonValue(value: unknown, ancestors = new Set<object>()): boolean {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value !== 'object') {
    return false;
  }
  if (ancestors.has(value)) {
    return false;
  }
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, ancestors))
    : (Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null) &&
      Object.values(value).every((entry) => isJsonValue(entry, ancestors));
  ancestors.delete(value);
  return valid;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertRequiredStrings(input: Record<string, unknown>): void {
  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof input[field] !== 'string') {
      throw new BadRequestException(
        `Notification intent ${field} must be a string`,
      );
    }
  }
}

function assertOccurredAt(value: unknown): asserts value is IsoInstant {
  if (
    typeof value !== 'string' ||
    !ISO_INSTANT_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new BadRequestException(
      'Notification intent occurredAt must be an ISO instant',
    );
  }
}

function assertPreferenceKey(
  value: unknown,
): asserts value is string | undefined {
  if (value !== undefined && typeof value !== 'string') {
    throw new BadRequestException(
      'Notification intent preferenceKey must be a string',
    );
  }
}

function assertRequestedChannels(
  value: unknown,
): asserts value is NotificationIntent['requestedChannels'] {
  if (
    !Array.isArray(value) ||
    !value.every(
      (channel) =>
        typeof channel === 'string' && NOTIFICATION_CHANNELS.has(channel),
    )
  ) {
    throw new BadRequestException(
      'Notification intent requestedChannels contains an unsupported channel',
    );
  }
}

function assertJsonData(
  value: unknown,
): asserts value is JsonObject | undefined {
  if (value !== undefined && (!isObject(value) || !isJsonValue(value))) {
    throw new BadRequestException(
      'Notification intent data must be a JSON object',
    );
  }
}

function assertCause(
  value: unknown,
): asserts value is { eventId: string; eventName: string } | undefined {
  if (value === undefined) {
    return;
  }
  if (
    !isObject(value) ||
    typeof value.eventId !== 'string' ||
    typeof value.eventName !== 'string'
  ) {
    throw new BadRequestException(
      'Notification intent cause requires eventId and eventName strings',
    );
  }
}

export function validateNotificationIntent(input: unknown): NotificationIntent {
  if (!isObject(input)) {
    throw new BadRequestException('Notification intent must be an object');
  }

  assertRequiredStrings(input);
  if (input.schemaVersion !== 1) {
    throw new BadRequestException(
      'Notification intent schemaVersion must be 1',
    );
  }
  assertOccurredAt(input.occurredAt);
  assertPreferenceKey(input.preferenceKey);
  assertRequestedChannels(input.requestedChannels);
  assertJsonData(input.data);
  assertCause(input.cause);

  return {
    schemaVersion: 1,
    // `assertRequiredStrings` checked these fields; the casts restore what it
    // proved, because it cannot narrow seven properties at once.
    userId: input.userId as string,
    sourceDomain: input.sourceDomain as string,
    type: input.type as string,
    ...(input.preferenceKey === undefined
      ? {}
      : { preferenceKey: input.preferenceKey }),
    title: input.title as string,
    body: input.body as string,
    ...(input.data === undefined ? {} : { data: structuredClone(input.data) }),
    requestedChannels: [...input.requestedChannels],
    deduplicationKey: input.deduplicationKey as string,
    occurredAt: input.occurredAt,
    ...(input.cause === undefined
      ? {}
      : {
          cause: {
            eventId: input.cause.eventId,
            eventName: input.cause.eventName,
          },
        }),
  };
}

@Injectable()
export class NotificationIntentReceiver implements NotificationIntentConsumer {
  accept(input: unknown): NotificationIntent {
    return validateNotificationIntent(input);
  }
}
