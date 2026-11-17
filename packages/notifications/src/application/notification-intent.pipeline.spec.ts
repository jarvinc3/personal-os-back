import type { NotificationIntent } from '@personal-os/contracts';
import type { DomainEventIdempotencyGuard } from '@personal-os/core';
import type {
  Notification,
  NotificationChannel,
  Prisma,
} from '@personal-os/database';
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

function notification(channel: NotificationChannel): Notification {
  return {
    id: `n-${channel}`,
    userId: 'user-1',
    type: 'event.reminder',
    channel,
    title: 'Reunión próxima',
    body: 'Comienza en 15 minutos',
    data: {},
    isRead: false,
    scheduledAt: null,
    sentAt: null,
    createdAt: new Date(),
  };
}

describe('NotificationIntentPipeline', () => {
  const createNotification = jest.fn();
  const findById = jest.fn();
  const notificationsRepo = {
    createNotification,
    findById,
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
      _receiptKey: string,
      _consumer: string,
      effect: (client: Prisma.TransactionClient) => Promise<unknown>,
    ) => effect(tx as Prisma.TransactionClient),
  );
  const claim = jest.fn().mockResolvedValue(true);
  const findReceiptEventId = jest.fn();
  const wasProcessed = jest.fn().mockResolvedValue(false);
  const tryClaim = jest.fn().mockResolvedValue(true);
  const idempotency = {
    runOnce,
    claim,
    findReceiptEventId,
    wasProcessed,
    tryClaim,
  } as unknown as DomainEventIdempotencyGuard;

  const pipeline = new NotificationIntentPipeline(
    notificationsRepo,
    notificationPolicy,
    notifications,
    idempotency,
  );

  const receiptKey =
    'notification-intent:user-1:agenda:agenda:meeting-1:reminder';

  beforeEach(() => {
    jest.clearAllMocks();
    evaluate.mockResolvedValue({ allowed: true });
    runOnce.mockImplementation(
      (
        _receiptKey: string,
        _consumer: string,
        effect: (client: Prisma.TransactionClient) => Promise<unknown>,
      ) => effect(tx as Prisma.TransactionClient),
    );
    findReceiptEventId.mockResolvedValue(null);
    wasProcessed.mockResolvedValue(false);
    tryClaim.mockResolvedValue(true);
    createNotification.mockImplementation(
      (input: { channel: NotificationChannel }) =>
        Promise.resolve(notification(input.channel)),
    );
    findById.mockImplementation((id: string) =>
      Promise.resolve(
        notification(id.replace('n-', '') as NotificationChannel),
      ),
    );
  });

  it('persists and delivers each allowed channel in order', async () => {
    const order: string[] = [];
    createNotification.mockImplementation(
      (input: { channel: NotificationChannel }) => {
        order.push(`persist:${input.channel}`);
        return Promise.resolve(notification(input.channel));
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
  });

  it('claims each channel and points to the persisted row in the same transaction', async () => {
    await pipeline.submit(intent());

    expect(runOnce).toHaveBeenNthCalledWith(
      1,
      receiptKey,
      'notifications:intent:IN_APP',
      expect.any(Function),
    );
    expect(runOnce).toHaveBeenNthCalledWith(
      2,
      receiptKey,
      'notifications:intent:PUSH',
      expect.any(Function),
    );
    expect(claim).toHaveBeenCalledWith(
      tx,
      'n-IN_APP',
      `notifications:intent-row:${receiptKey}:IN_APP`,
    );
  });

  it('passes the neutral preference and domain to the policy', async () => {
    await pipeline.submit(intent());

    expect(evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        channel: 'IN_APP',
        sourceDomain: 'agenda',
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

  it('retries the channel delivery after an enqueue failure without duplicating rows', async () => {
    deliverPersisted.mockRejectedValueOnce(new Error('queue unavailable'));

    await expect(pipeline.submit(intent())).rejects.toThrow(
      'queue unavailable',
    );
    expect(createNotification).toHaveBeenCalledTimes(2);
    expect(tryClaim).not.toHaveBeenCalled();

    runOnce.mockResolvedValue(undefined);
    findReceiptEventId
      .mockResolvedValueOnce('n-IN_APP')
      .mockResolvedValueOnce('n-PUSH');

    const retry = await pipeline.submit(intent());

    expect(createNotification).toHaveBeenCalledTimes(2);
    expect(deliverPersisted).toHaveBeenCalledTimes(3);
    expect(tryClaim).toHaveBeenCalledWith(
      'n-IN_APP',
      'notifications:intent-delivered:IN_APP',
    );
    expect(tryClaim).toHaveBeenCalledWith(
      'n-PUSH',
      'notifications:intent-delivered:PUSH',
    );
    expect(retry).toEqual({
      accepted: false,
      notificationIds: ['n-IN_APP', 'n-PUSH'],
    });
  });

  it('does not deliver again a channel already marked as delivered', async () => {
    runOnce.mockResolvedValue(undefined);
    findReceiptEventId
      .mockResolvedValueOnce('n-IN_APP')
      .mockResolvedValueOnce('n-PUSH');
    wasProcessed.mockResolvedValue(true);

    await expect(pipeline.submit(intent())).resolves.toEqual({
      accepted: false,
      notificationIds: ['n-IN_APP', 'n-PUSH'],
    });
    expect(deliverPersisted).not.toHaveBeenCalled();
    expect(tryClaim).not.toHaveBeenCalled();
  });

  it('fails loudly when a claim has no persisted row pointer', async () => {
    runOnce.mockResolvedValue(undefined);
    findReceiptEventId.mockResolvedValue(null);

    await expect(pipeline.submit(intent())).rejects.toThrow(
      'has no persisted notification for channel IN_APP',
    );
  });
});
