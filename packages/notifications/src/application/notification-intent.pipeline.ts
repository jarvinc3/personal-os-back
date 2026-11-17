import { Injectable } from '@nestjs/common';
import type {
  NotificationIntent,
  NotificationIntentSink,
} from '@personal-os/contracts';
import { DomainEventIdempotencyGuard } from '@personal-os/core';
import type {
  Notification,
  NotificationChannel,
  Prisma,
} from '@personal-os/database';
import { NotificationsRepository } from '../infrastructure/notifications.repository';
import {
  NotificationPolicyService,
  type NotificationDispatchContext,
} from './notification-policy.service';
import { NotificationsService } from './notifications.service';

const INTENT_CONSUMER = 'notifications:intent';
const DEDUPLICATION_PREFIX = 'notification-intent';

/**
 * Generic delivery pipeline: policy per channel, durable rows with the intent
 * receipt in one transaction, and delivery only after that commit.
 */
@Injectable()
export class NotificationIntentPipeline implements NotificationIntentSink {
  constructor(
    private readonly notificationsRepo: NotificationsRepository,
    private readonly notificationPolicy: NotificationPolicyService,
    private readonly notifications: NotificationsService,
    private readonly idempotency: DomainEventIdempotencyGuard,
  ) {}

  async submit(
    intent: NotificationIntent,
  ): Promise<{ accepted: boolean; notificationIds: readonly string[] }> {
    const channels = await this.allowedChannels(intent);
    if (channels.length === 0) {
      return { accepted: false, notificationIds: [] };
    }

    const created = await this.idempotency.runOnce(
      this.receiptKey(intent),
      INTENT_CONSUMER,
      (tx) => this.persist(intent, channels, tx),
    );
    if (!created) {
      return { accepted: false, notificationIds: [] };
    }

    for (const notification of created) {
      await this.notifications.deliverPersisted(notification);
    }
    return {
      accepted: true,
      notificationIds: created.map((notification) => notification.id),
    };
  }

  private async allowedChannels(
    intent: NotificationIntent,
  ): Promise<NotificationChannel[]> {
    const moduleSlug = intent.data?.moduleSlug;
    const allowed: NotificationChannel[] = [];
    for (const channel of intent.requestedChannels) {
      const context: NotificationDispatchContext = {
        userId: intent.userId,
        channel,
        data: intent.data,
        moduleSlug: typeof moduleSlug === 'string' ? moduleSlug : undefined,
        preferenceKey: intent.preferenceKey,
      };
      const decision = await this.notificationPolicy.evaluate(context);
      if (!decision.allowed) {
        this.notificationPolicy.logSkipped(context, decision.reason);
        continue;
      }
      allowed.push(channel);
    }
    return allowed;
  }

  private async persist(
    intent: NotificationIntent,
    channels: readonly NotificationChannel[],
    tx: Prisma.TransactionClient,
  ): Promise<Notification[]> {
    const rows: Notification[] = [];
    for (const channel of channels) {
      rows.push(
        await this.notificationsRepo.createNotification(
          {
            userId: intent.userId,
            type: intent.type,
            channel,
            title: intent.title,
            body: intent.body,
            data: intent.data,
          },
          tx,
        ),
      );
    }
    return rows;
  }

  /** The receipt is per user, so the same key can repeat across users. */
  private receiptKey(intent: NotificationIntent): string {
    return `${DEDUPLICATION_PREFIX}:${intent.userId}:${intent.deduplicationKey}`;
  }
}
