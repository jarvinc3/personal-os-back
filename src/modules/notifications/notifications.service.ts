import { Injectable, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AppEvents } from '../../core/events/event.constants';
import { QueueNames } from '../../core/queues/queue.constants';
import { NotificationDispatchJob } from '../../core/queues/queue-jobs';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsRepository } from './notifications.repository';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly notificationsRepo: NotificationsRepository,
    private readonly notificationsGateway: NotificationsGateway,
    private readonly eventEmitter: EventEmitter2,
    @Optional()
    @InjectQueue(QueueNames.NOTIFICATIONS)
    private readonly notificationsQueue?: Queue<NotificationDispatchJob>,
  ) {}

  async create(dto: CreateNotificationDto) {
    const created = await this.notificationsRepo.createNotification({
      userId: dto.userId,
      type: dto.type,
      channel: dto.channel,
      title: dto.title,
      body: dto.body,
      data: dto.data,
    });

    this.notificationsGateway.emitToUser(created.userId, 'notification.new', {
      id: created.id,
      type: created.type,
      title: created.title,
      body: created.body,
      data: created.data,
      createdAt: created.createdAt,
    });

    this.eventEmitter.emit(AppEvents.AI_ACTION_COMPLETED, {
      userId: created.userId,
      actionType: 'notification.created',
      payload: { notificationId: created.id },
    });

    if (this.notificationsQueue) {
      await this.notificationsQueue.add(
        'dispatch-notification',
        {
          notificationId: created.id,
          userId: created.userId,
          channel: created.channel,
          title: created.title,
          body: created.body,
          data: (created.data ?? {}) as Record<string, unknown>,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: 100,
          removeOnFail: 300,
        },
      );
    }

    return created;
  }

  markAsRead(id: string, userId: string) {
    return this.notificationsRepo.markAsRead(id, userId);
  }
}
