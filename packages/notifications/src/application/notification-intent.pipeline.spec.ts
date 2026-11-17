import type { NotificationIntent } from '@personal-os/contracts';
import type { DomainEventIdempotencyGuard } from '@personal-os/core';
import type { Notification, Prisma } from '@personal-os/database';
import type { NotificationsRepository } from '../infrastructure/notifications.repository';
import { NotificationIntentPipeline } from './notification-intent.pipeline';
import type { NotificationPolicyService } from './notification-policy.service';
import type { NotificationsService } from './notifications.service';

function intent(
  overrides: Partial<NotificationIntent> = {},
): NotificationIntent {
  return {
    schemaVersion: 1,
    userId: 'user-1',
    sourceDomain: 'agenda',
    type: 'event.reminder',
    preferenceKey: 'eventReminders',
    title: 'Reunión próxima',
    body: 'Comienza en 15 minutos',
    data: { moduleSlug: 'agenda', eventId: 'meeting-1' },
    requestedChannels: ['IN_APP', 'PUSH'],
    deduplicationKey: 'agenda:meeting-1:reminder',
    occurredAt: '2026-11-03T12:00:00.000Z',
    ...overrides,
  };
}

describe('NotificationIntentPipeline', () => {
  const createNotification = jest.fn();
  const notificationsRepo = {
    createNotification,
  } as unknown as NotificationsRepository;

  const evaluate = jest.fn().mockResolvedValue({ allowed: true });
  const logSkipped = jest.fn();
  const notificationPolicy = {
    evaluate,
    logSkipped,
  } as unknown as NotificationPolicyService;

  const deliverPersisted = jest.fn().mockResolvedValue(undefined);
  const notifications = {
    deliverPersisted,
  } as unknown as NotificationsService;

  const tx = {};
  const runOnce = jest.fn(
    (
      _eventId: string,
      _consumer: string,
      effect: (client: Prisma.TransactionClient) => Promise<unknown>,
    ) => effect(tx as Prisma.TransactionClient),
  );
  const idempotency = { runOnce } as unknown as DomainEventIdempotencyGuard;

  const pipeline = new NotificationIntentPipeline(
    notificationsRepo,
    notificationPolicy,
    notifications,
    idempotency,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    evaluate.mockResolvedValue({ allowed: true });
    runOnce.mockImplementation(
      (
        _eventId: string,
        _consumer: string,
        effect: (client: Prisma.TransactionClient) => Promise<unknown>,
      ) => effect(tx as Prisma.TransactionClient),
    );
    createNotification.mockImplementation(
      (input: { channel: string } & Record<string, unknown>) =>
        Promise.resolve({
          id: `n-${input.channel}`,
          userId: 'user-1',
          type: 'event.reminder',
          channel: input.channel,
          title: 'Reunión próxima',
          body: 'Comienza en 15 minutos',
          data: {},
          createdAt: new Date(),
        }),
    );
  });

  it('persists the allowed channels in one transaction and delivers after that', async () => {
    const order: string[] = [];
    createNotification.mockImplementation(
      (input: { channel: string } & Record<string, unknown>) => {
        order.push(`persist:${input.channel}`);
        return Promise.resolve({
          id: `n-${input.channel}`,
          userId: 'user-1',
          type: 'event.reminder',
          channel: input.channel,
          title: 'Reunión próxima',
          body: 'Comienza en 15 minutos',
          data: {},
          createdAt: new Date(),
        });
      },
    );
    deliverPersisted.mockImplementation((row: Notification) => {
      order.push(`deliver:${row.channel}`);
      return Promise.resolve();
    });

    const submission = await pipeline.submit(intent());

    expect(submission).toEqual({
      accepted: true,
      notificationIds: ['n-IN_APP', 'n-PUSH'],
    });
    expect(order).toEqual([
      'persist:IN_APP',
      'persist:PUSH',
      'deliver:IN_APP',
      'deliver:PUSH',
    ]);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'IN_APP', userId: 'user-1' }),
      tx,
    );
  });

  it('keys the receipt by user and deduplication key', async () => {
    await pipeline.submit(intent());

    expect(runOnce).toHaveBeenCalledWith(
      'notification-intent:user-1:agenda:meeting-1:reminder',
      'notifications:intent',
      expect.any(Function),
    );
  });

  it('passes the neutral preference and module to the policy', async () => {
    await pipeline.submit(intent());

    expect(evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        channel: 'IN_APP',
        moduleSlug: 'agenda',
        preferenceKey: 'eventReminders',
      }),
    );
  });

  it('skips the channel whose preference is off and delivers the rest', async () => {
    evaluate.mockImplementation(({ channel }: { channel: string }) =>
      Promise.resolve(
        channel === 'PUSH'
          ? {
              allowed: false,
              reason: 'module_notification_disabled:agenda.eventReminders',
            }
          : { allowed: true },
      ),
    );

    const submission = await pipeline.submit(intent());

    expect(submission).toEqual({
      accepted: true,
      notificationIds: ['n-IN_APP'],
    });
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(deliverPersisted).toHaveBeenCalledTimes(1);
    expect(logSkipped).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'PUSH' }),
      'module_notification_disabled:agenda.eventReminders',
    );
  });

  it('persists nothing when every channel is filtered out', async () => {
    evaluate.mockResolvedValue({
      allowed: false,
      reason: 'quiet_hours_active',
    });

    await expect(pipeline.submit(intent())).resolves.toEqual({
      accepted: false,
      notificationIds: [],
    });
    expect(runOnce).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
    expect(deliverPersisted).not.toHaveBeenCalled();
  });

  it('does not create or deliver again when the intent was already processed', async () => {
    runOnce.mockResolvedValueOnce(undefined);

    await expect(pipeline.submit(intent())).resolves.toEqual({
      accepted: false,
      notificationIds: [],
    });
    expect(createNotification).not.toHaveBeenCalled();
    expect(deliverPersisted).not.toHaveBeenCalled();
  });

  it('propagates a channel failure and keeps the persisted rows for the retry', async () => {
    deliverPersisted.mockRejectedValueOnce(new Error('queue unavailable'));

    await expect(pipeline.submit(intent())).rejects.toThrow(
      'queue unavailable',
    );
    expect(createNotification).toHaveBeenCalledTimes(2);

    runOnce.mockResolvedValueOnce(undefined);
    await expect(pipeline.submit(intent())).resolves.toEqual({
      accepted: false,
      notificationIds: [],
    });
    expect(createNotification).toHaveBeenCalledTimes(2);
  });
});
