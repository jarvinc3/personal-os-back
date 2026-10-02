import { Job } from 'bullmq';
import type { NotificationDispatchJob } from '../../../core/queues/queue-jobs';
import { NotificationsProcessor } from './notifications.processor';

describe('NotificationsProcessor', () => {
  it('sends push via PushSenderService when channel is PUSH', async () => {
    const notificationsRepo = {
      findActivePushTokens: jest.fn().mockResolvedValue([
        { token: 'ExponentPushToken[abc]', platform: 'ios' },
      ]),
    };
    const pushSender = {
      sendToTokenEntries: jest.fn().mockResolvedValue({
        sent: 1,
        failed: 0,
        deactivatedTokens: [],
      }),
      deactivateInvalidTokens: jest.fn().mockResolvedValue(undefined),
    };

    const processor = new NotificationsProcessor(
      notificationsRepo as never,
      pushSender as never,
      undefined,
    );

    const job = {
      data: {
        notificationId: 'n1',
        userId: 'u1',
        channel: 'PUSH',
        title: 'Hello',
        body: 'World',
        data: {},
      },
    } as Job<NotificationDispatchJob>;

    await processor.process(job);

    expect(pushSender.sendToTokenEntries).toHaveBeenCalledWith(
      [{ token: 'ExponentPushToken[abc]', platform: 'ios' }],
      {
        title: 'Hello',
        body: 'World',
        data: expect.objectContaining({ notificationId: 'n1' }),
      },
    );
  });

  it('sends web push tokens with platform metadata', async () => {
    const webToken = JSON.stringify({
      endpoint: 'https://push.example.com/subscription',
      keys: { p256dh: 'key', auth: 'auth' },
    });
    const notificationsRepo = {
      findActivePushTokens: jest.fn().mockResolvedValue([
        { token: webToken, platform: 'web' },
      ]),
    };
    const pushSender = {
      sendToTokenEntries: jest.fn().mockResolvedValue({
        sent: 1,
        failed: 0,
        deactivatedTokens: [],
      }),
      deactivateInvalidTokens: jest.fn().mockResolvedValue(undefined),
    };

    const processor = new NotificationsProcessor(
      notificationsRepo as never,
      pushSender as never,
      undefined,
    );

    const job = {
      data: {
        notificationId: 'n2',
        userId: 'u1',
        channel: 'PUSH',
        title: 'Web',
        body: 'Push',
        data: {},
      },
    } as Job<NotificationDispatchJob>;

    await processor.process(job);

    expect(pushSender.sendToTokenEntries).toHaveBeenCalledWith(
      [{ token: webToken, platform: 'web' }],
      expect.objectContaining({ title: 'Web', body: 'Push' }),
    );
  });
});
