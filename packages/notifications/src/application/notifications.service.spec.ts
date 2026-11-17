import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import type { NotificationDispatchJob } from '@personal-os/core';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  const notificationsRepo = {
    createNotification: jest.fn(),
  };
  const notificationsGateway = {
    emitToUser: jest.fn(),
  };
  const notificationPolicy = {
    evaluate: jest.fn().mockResolvedValue({ allowed: true }),
    logSkipped: jest.fn(),
  };
  const emit = jest.fn();
  const eventEmitter = {
    emit,
  } as unknown as EventEmitter2;
  const queueAdd = jest.fn().mockResolvedValue({ id: 'q1' });
  const notificationsQueue = {
    add: queueAdd,
  } as unknown as Queue<NotificationDispatchJob>;

  function createService(emailDeliveryEnabled: boolean) {
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'EMAIL_DELIVERY_ENABLED') {
          return emailDeliveryEnabled;
        }
        return undefined;
      }),
    } as unknown as ConfigService;

    return new NotificationsService(
      notificationsRepo as never,
      notificationsGateway as never,
      notificationPolicy as never,
      eventEmitter,
      config as never,
      notificationsQueue,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    notificationsRepo.createNotification.mockImplementation(
      (input: {
        userId: string;
        type: string;
        channel: string;
        title: string;
        body: string;
        data?: Record<string, unknown>;
      }) =>
        Promise.resolve({
          id: 'n1',
          userId: input.userId,
          type: input.type,
          channel: input.channel,
          title: input.title,
          body: input.body,
          data: input.data ?? {},
          createdAt: new Date(),
        }),
    );
  });

  it('enqueues EMAIL when EMAIL_DELIVERY_ENABLED is true', async () => {
    const service = createService(true);

    await service.create('u1', {
      type: 'test',
      channel: 'EMAIL',
      title: 'Hello',
      body: 'World',
      data: { source: 'dev' },
    });

    expect(queueAdd).toHaveBeenCalledWith(
      'dispatch-notification',
      expect.objectContaining({
        notificationId: 'n1',
        channel: 'EMAIL',
        title: 'Hello',
      }),
      expect.objectContaining({ jobId: 'n1' }),
    );
  });

  it('does not enqueue EMAIL when EMAIL_DELIVERY_ENABLED is false', async () => {
    const service = createService(false);

    const created = await service.create('u1', {
      type: 'test',
      channel: 'EMAIL',
      title: 'Hello',
      body: 'World',
      data: { source: 'dev' },
    });

    expect(created).toMatchObject({ id: 'n1', channel: 'EMAIL' });
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('still enqueues PUSH when EMAIL delivery is disabled', async () => {
    const service = createService(false);

    await service.create('u1', {
      type: 'test',
      channel: 'PUSH',
      title: 'Hello',
      body: 'World',
      data: { source: 'dev' },
    });

    expect(queueAdd).toHaveBeenCalledWith(
      'dispatch-notification',
      expect.objectContaining({ channel: 'PUSH' }),
      expect.objectContaining({ jobId: 'n1' }),
    );
  });

  it('emits websocket for IN_APP and enqueues regardless of email flag', async () => {
    const service = createService(false);

    await service.create('u1', {
      type: 'test',
      channel: 'IN_APP',
      title: 'Hello',
      body: 'World',
      data: { source: 'dev' },
    });

    expect(notificationsGateway.emitToUser).toHaveBeenCalledWith(
      'u1',
      'notification.new',
      expect.objectContaining({ id: 'n1', title: 'Hello' }),
    );
    expect(queueAdd).toHaveBeenCalled();
  });

  it('persists an event notification in the supplied transaction without external effects', async () => {
    const service = createService(false);
    const tx = {};
    await service.create(
      'u1',
      {
        type: 'test',
        channel: 'IN_APP',
        title: 'Hello',
        body: 'World',
        data: { source: 'dev' },
      },
      tx as never,
    );
    expect(notificationsRepo.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1' }),
      tx,
    );
    expect(notificationsGateway.emitToUser).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('rejects transactional PUSH/EMAIL instead of silently dropping dispatch', async () => {
    const service = createService(true);
    await expect(
      service.create(
        'u1',
        {
          type: 'test',
          channel: 'PUSH',
          title: 'Hello',
          body: 'World',
        },
        {} as never,
      ),
    ).rejects.toThrow('only supports IN_APP');
    expect(notificationsRepo.createNotification).not.toHaveBeenCalled();
  });
});
