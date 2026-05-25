import { Job } from 'bullmq';
import { NotificationsProcessor } from './notifications.processor';
import type { NotificationDispatchJob } from '../../core/queues/queue-jobs';

describe('NotificationsProcessor', () => {
  it('sends push via PushSenderService when channel is PUSH', async () => {
    const notificationsRepo = {
      findActivePushTokens: jest.fn().mockResolvedValue([
        { token: 'ExponentPushToken[abc]' },
      ]),
    };
    const notificationPolicy = {
      evaluate: jest.fn().mockResolvedValue({ allowed: true }),
      logSkipped: jest.fn(),
    };
    const pushSender = {
      sendToTokens: jest.fn().mockResolvedValue({ sent: 1, failed: 0 }),
    };

    const processor = new NotificationsProcessor(
      notificationsRepo as never,
      notificationPolicy as never,
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

    expect(pushSender.sendToTokens).toHaveBeenCalledWith(['ExponentPushToken[abc]'], {
      title: 'Hello',
      body: 'World',
      data: expect.objectContaining({ notificationId: 'n1' }),
    });
  });
});
