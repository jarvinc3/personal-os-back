import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  JsonObject,
  NotificationIntent,
  NotificationIntentConsumer,
} from '@personal-os/contracts';

const notificationChannels = new Set(['IN_APP', 'PUSH', 'EMAIL']);

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

export function validateNotificationIntent(input: unknown): NotificationIntent {
  if (!isObject(input)) {
    throw new BadRequestException('Notification intent must be an object');
  }

  const requiredStrings = [
    'userId',
    'sourceDomain',
    'type',
    'title',
    'body',
    'deduplicationKey',
    'occurredAt',
  ] as const;
  for (const field of requiredStrings) {
    if (typeof input[field] !== 'string') {
      throw new BadRequestException(
        `Notification intent ${field} must be a string`,
      );
    }
  }
  if (input.schemaVersion !== 1) {
    throw new BadRequestException(
      'Notification intent schemaVersion must be 1',
    );
  }
  if (
    typeof input.occurredAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      input.occurredAt,
    ) ||
    !Number.isFinite(Date.parse(input.occurredAt))
  ) {
    throw new BadRequestException(
      'Notification intent occurredAt must be an ISO instant',
    );
  }
  if (
    input.preferenceKey !== undefined &&
    typeof input.preferenceKey !== 'string'
  ) {
    throw new BadRequestException(
      'Notification intent preferenceKey must be a string',
    );
  }
  if (
    !Array.isArray(input.requestedChannels) ||
    !input.requestedChannels.every(
      (channel) =>
        typeof channel === 'string' && notificationChannels.has(channel),
    )
  ) {
    throw new BadRequestException(
      'Notification intent requestedChannels contains an unsupported channel',
    );
  }
  if (
    input.data !== undefined &&
    (!isObject(input.data) || !isJsonValue(input.data))
  ) {
    throw new BadRequestException(
      'Notification intent data must be a JSON object',
    );
  }
  if (input.cause !== undefined) {
    if (
      !isObject(input.cause) ||
      typeof input.cause.eventId !== 'string' ||
      typeof input.cause.eventName !== 'string'
    ) {
      throw new BadRequestException(
        'Notification intent cause requires eventId and eventName strings',
      );
    }
  }

  return {
    schemaVersion: 1,
    userId: input.userId as string,
    sourceDomain: input.sourceDomain as string,
    type: input.type as string,
    ...(input.preferenceKey === undefined
      ? {}
      : { preferenceKey: input.preferenceKey }),
    title: input.title as string,
    body: input.body as string,
    ...(input.data === undefined
      ? {}
      : { data: structuredClone(input.data) as JsonObject }),
    requestedChannels: [
      ...input.requestedChannels,
    ] as NotificationIntent['requestedChannels'],
    deduplicationKey: input.deduplicationKey as string,
    occurredAt: input.occurredAt,
    ...(input.cause === undefined
      ? {}
      : {
          cause: {
            eventId: input.cause.eventId as string,
            eventName: input.cause.eventName as string,
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
