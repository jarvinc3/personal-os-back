import { BadRequestException } from '@nestjs/common';
import type { IntentProducer } from '@personal-os/contracts';
import { NotificationIntentReceiver } from './notification-intent.receiver';

describe('NotificationIntentReceiver', () => {
  const receiver = new NotificationIntentReceiver();

  it('accepts and validates an intent from a non-Finance domain', () => {
    const producer: IntentProducer<{ eventId: string }> = {
      toIntents: ({ eventId }) => [
        {
          schemaVersion: 1,
          userId: 'user-1',
          sourceDomain: 'agenda',
          type: 'event.reminder',
          preferenceKey: 'eventReminders',
          title: 'Reunión próxima',
          body: 'Comienza en 15 minutos',
          data: { eventId, location: 'Sala A' },
          requestedChannels: ['IN_APP', 'PUSH'],
          deduplicationKey: `agenda:${eventId}:reminder`,
          occurredAt: '2026-11-03T12:00:00.000Z',
        },
      ],
    };
    const intent = producer.toIntents({ eventId: 'meeting-1' })[0];

    expect(receiver.accept(intent)).toEqual(intent);
  });

  it.each([
    [
      {
        schemaVersion: 2,
        userId: 'u',
        sourceDomain: 'agenda',
        type: 'reminder',
        title: 'Title',
        body: 'Body',
        requestedChannels: ['IN_APP'],
        deduplicationKey: 'key',
        occurredAt: '2026-11-03T12:00:00.000Z',
      },
      'schemaVersion',
    ],
    [
      {
        schemaVersion: 1,
        userId: 'u',
        sourceDomain: 'agenda',
        type: 'reminder',
        title: 'Title',
        body: 'Body',
        requestedChannels: ['SMS'],
        deduplicationKey: 'key',
        occurredAt: '2026-11-03T12:00:00.000Z',
      },
      'requestedChannels',
    ],
    [
      {
        schemaVersion: 1,
        userId: 'u',
        sourceDomain: 'agenda',
        type: 'reminder',
        title: 'Title',
        body: 'Body',
        requestedChannels: ['IN_APP'],
        deduplicationKey: 'key',
        occurredAt: 'not-a-date',
      },
      'occurredAt',
    ],
  ])('rejects malformed payloads', (intent, field) => {
    expect(() => receiver.accept(intent)).toThrow(BadRequestException);
    expect(() => receiver.accept(intent)).toThrow(String(field));
  });
});
