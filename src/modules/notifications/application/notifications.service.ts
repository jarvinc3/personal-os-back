import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import type { Env } from '../../../config';
import { NotificationCreatedEvent } from '../../../core/events/domain-events';
import { AppEvents } from '../../../core/events/event.constants';
import { paginate } from '../../../core/pagination/pagination.dto';
import { NotificationDispatchJob } from '../../../core/queues/queue-jobs';
import { QueueNames } from '../../../core/queues/queue.constants';
import { NotificationsRepository } from '../infrastructure/notifications.repository';
import { CreateNotificationDto } from '../presentation/dto/create-notification.dto';
import { ListNotificationsQueryDto } from '../presentation/dto/list-notifications-query.dto';
import { NotificationsGateway } from '../presentation/notifications.gateway';
import { NotificationPolicyService } from './notification-policy.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly notificationsRepo: NotificationsRepository,
    private readonly notificationsGateway: NotificationsGateway,
    private readonly notificationPolicy: NotificationPolicyService,
    private readonly eventEmitter: EventEmitter2,
    private readonly config: ConfigService<Env, true>,
    @Optional()
    @InjectQueue(QueueNames.NOTIFICATIONS)
    private readonly notificationsQueue?: Queue<NotificationDispatchJob>,
  ) {}

  async create(userId: string, dto: CreateNotificationDto) {
    const isDevTestNotification =
      process.env.NODE_ENV === 'test' && dto.data?.source === 'dev';

    if (!isDevTestNotification) {
      const policy = await this.notificationPolicy.evaluate({
        userId,
        channel: dto.channel,
        data: dto.data,
      });

      if (!policy.allowed) {
        this.notificationPolicy.logSkipped(
          { userId, channel: dto.channel, data: dto.data },
          policy.reason,
        );
        return null;
      }
    }

    const created = await this.notificationsRepo.createNotification({
      userId,
      type: dto.type,
      channel: dto.channel,
      title: dto.title,
      body: dto.body,
      data: dto.data,
    });

    if (dto.channel === 'IN_APP') {
      this.notificationsGateway.emitToUser(created.userId, 'notification.new', {
        id: created.id,
        type: created.type,
        title: created.title,
        body: created.body,
        data: created.data,
        createdAt: created.createdAt,
      });
    }

    this.eventEmitter.emit(
      AppEvents.NOTIFICATION_CREATED,
      new NotificationCreatedEvent(created.userId, created.id),
    );

    const emailDeliveryEnabled = this.config.get('EMAIL_DELIVERY_ENABLED', {
      infer: true,
    });

    // EMAIL A2: enqueue only when delivery is explicitly enabled.
    if (created.channel === 'EMAIL' && !emailDeliveryEnabled) {
      this.logger.warn(
        `EMAIL notification ${created.id} not enqueued: EMAIL_DELIVERY_ENABLED=false`,
      );
    } else if (this.notificationsQueue) {
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

  async list(userId: string, query: ListNotificationsQueryDto) {
    const inAppEnabled = await this.notificationPolicy.isInAppListingEnabled(userId);
    if (!inAppEnabled && (query.channel ?? 'IN_APP') === 'IN_APP') {
      return paginate([], 0, query);
    }

    const [items, total] = await this.notificationsRepo.findByUser(userId, query);
    return paginate(items, total, query);
  }

  async unreadCount(userId: string) {
    const inAppEnabled = await this.notificationPolicy.isInAppListingEnabled(userId);
    if (!inAppEnabled) {
      return { count: 0 };
    }
    const count = await this.notificationsRepo.countUnread(userId, 'IN_APP');
    return { count };
  }

  markAsRead(id: string, userId: string) {
    return this.notificationsRepo.markAsRead(id, userId);
  }

  async markAllAsRead(userId: string) {
    const result = await this.notificationsRepo.markAllAsRead(userId, 'IN_APP');
    return { updated: result.count };
  }
}
