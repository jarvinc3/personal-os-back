import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import type { Env } from '@personal-os/config';
import type { Notification, Prisma } from '@personal-os/database';
import { NotificationCreatedEvent } from '@personal-os/core';
import { AppEvents } from '@personal-os/core';
import { clampPageLimit, toCursorPage } from '@personal-os/core';
import { NotificationDispatchJob } from '@personal-os/core';
import { QueueNames } from '@personal-os/core';
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

  async create(
    userId: string,
    dto: CreateNotificationDto,
    tx?: Prisma.TransactionClient,
  ) {
    if (tx && dto.channel !== 'IN_APP') {
      throw new Error(
        'Transactional notification creation only supports IN_APP',
      );
    }
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

    const input = {
      userId,
      type: dto.type,
      channel: dto.channel,
      title: dto.title,
      body: dto.body,
      data: dto.data,
    };
    const created = tx
      ? await this.notificationsRepo.createNotification(input, tx)
      : await this.notificationsRepo.createNotification(input);

    if (tx) {
      // The listener publishes the transient WebSocket update after commit.
      // The persisted IN_APP notification is the durable delivery.
      return created;
    }

    await this.deliverPersisted(created);
    return created;
  }

  /**
   * Delivers an already persisted row: socket for IN_APP, queue for PUSH and
   * EMAIL. The caller owns deduplication, so a retry does not duplicate rows.
   */
  async deliverPersisted(created: Notification): Promise<void> {
    if (created.channel === 'IN_APP') {
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
      return;
    }

    if (!this.notificationsQueue) {
      return;
    }

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

  publishInApp(created: Notification): void {
    try {
      this.notificationsGateway.emitToUser(created.userId, 'notification.new', {
        id: created.id,
        type: created.type,
        title: created.title,
        body: created.body,
        data: created.data,
        createdAt: created.createdAt,
      });
      this.eventEmitter.emit(
        AppEvents.NOTIFICATION_CREATED,
        new NotificationCreatedEvent(created.userId, created.id),
      );
    } catch (error) {
      // A disconnected socket cannot undo a committed notification. The client
      // recovers it through the list/unread endpoints after reconnecting.
      this.logger.warn(
        `IN_APP update unavailable for notification ${created.id}: ${String(error)}`,
      );
    }
  }

  async list(userId: string, query: ListNotificationsQueryDto) {
    const inAppEnabled =
      await this.notificationPolicy.isInAppListingEnabled(userId);
    if (!inAppEnabled && (query.channel ?? 'IN_APP') === 'IN_APP') {
      return { items: [], nextCursor: null, hasMore: false };
    }

    const rows = await this.notificationsRepo.findByUser(userId, query);
    return toCursorPage(rows, clampPageLimit(query.limit), (row) =>
      row.createdAt.toISOString(),
    );
  }

  async unreadCount(userId: string) {
    const inAppEnabled =
      await this.notificationPolicy.isInAppListingEnabled(userId);
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

  /** Deletes the requested branches only; each one counts its own rows. */
  async wipeAllForUser(
    userId: string,
    branchIds: readonly string[] = [
      'notifications.history',
      'notifications.pushTokens',
    ],
  ): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    if (branchIds.includes('notifications.history')) {
      counts['notifications.history'] = (
        await this.notificationsRepo.deleteAllForUser(userId)
      ).count;
    }
    if (branchIds.includes('notifications.pushTokens')) {
      counts['notifications.pushTokens'] = (
        await this.notificationsRepo.deleteAllPushTokensForUser(userId)
      ).count;
    }
    return counts;
  }

  /** Rows the wipe would delete today, with the same definition it uses. */
  async countForUser(userId: string): Promise<Record<string, number>> {
    return {
      'notifications.history':
        await this.notificationsRepo.countAllForUser(userId),
      'notifications.pushTokens':
        await this.notificationsRepo.countAllPushTokensForUser(userId),
    };
  }
}
