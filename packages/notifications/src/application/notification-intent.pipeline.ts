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

const CLAIM_CONSUMER = 'notifications:intent';
const ROW_CONSUMER = 'notifications:intent-row';
const DELIVERED_CONSUMER = 'notifications:intent-delivered';
const RECEIPT_PREFIX = 'notification-intent';

type ClaimedChannel = { notification: Notification; created: boolean };

/**
 * Generic delivery pipeline: policy per channel, durable rows with their
 * receipt in one transaction, and delivery only after that commit. A failed
 * delivery keeps its channel retriable because the row pointer and the
 * delivered receipt are recorded separately.
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

    const receiptKey = this.receiptKey(intent);
    const channelResults: ClaimedChannel[] = [];
    for (const channel of channels) {
      channelResults.push(await this.claimChannel(intent, channel, receiptKey));
    }

    for (const channelResult of channelResults) {
      await this.deliverIfPending(channelResult.notification);
    }

    return {
      accepted: channelResults.some((channelResult) => channelResult.created),
      notificationIds: channelResults.map(
        (channelResult) => channelResult.notification.id,
      ),
    };
  }

  private async claimChannel(
    intent: NotificationIntent,
    channel: NotificationChannel,
    receiptKey: string,
  ): Promise<ClaimedChannel> {
    const notification = await this.idempotency.runOnce(
      receiptKey,
      `${CLAIM_CONSUMER}:${channel}`,
      async (tx) => {
        const row = await this.persistChannel(intent, channel, tx);
        await this.idempotency.claim(
          tx,
          row.id,
          this.rowConsumer(receiptKey, channel),
        );
        return row;
      },
    );
    if (notification) {
      return { notification, created: true };
    }
    return {
      notification: await this.persistedNotification(receiptKey, channel),
      created: false,
    };
  }

  private async persistedNotification(
    receiptKey: string,
    channel: NotificationChannel,
  ): Promise<Notification> {
    const notificationId = await this.idempotency.findReceiptEventId(
      this.rowConsumer(receiptKey, channel),
    );
    if (!notificationId) {
      throw new Error(
        `Intent ${receiptKey} has no persisted notification for channel ${channel}`,
      );
    }
    const notification = await this.notificationsRepo.findById(notificationId);
    if (!notification) {
      throw new Error(
        `Persisted intent notification ${notificationId} not found`,
      );
    }
    return notification;
  }

  /** A channel already delivered by another attempt is not sent twice. */
  private async deliverIfPending(notification: Notification): Promise<void> {
    const consumer = `${DELIVERED_CONSUMER}:${notification.channel}`;
    if (await this.idempotency.wasProcessed(notification.id, consumer)) {
      return;
    }
    await this.notifications.deliverPersisted(notification);
    await this.idempotency.tryClaim(notification.id, consumer);
  }

  private persistChannel(
    intent: NotificationIntent,
    channel: NotificationChannel,
    tx: Prisma.TransactionClient,
  ): Promise<Notification> {
    return this.notificationsRepo.createNotification(
      {
        userId: intent.userId,
        type: intent.type,
        channel,
        title: intent.title,
        body: intent.body,
        data: intent.data,
      },
      tx,
    );
  }

  private async allowedChannels(
    intent: NotificationIntent,
  ): Promise<NotificationChannel[]> {
    const allowed: NotificationChannel[] = [];
    for (const channel of intent.requestedChannels) {
      const context: NotificationDispatchContext = {
        userId: intent.userId,
        channel,
        data: intent.data,
        sourceDomain: intent.sourceDomain,
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

  /** Receipts are per user and domain, so equal keys do not collide. */
  private receiptKey(intent: NotificationIntent): string {
    return `${RECEIPT_PREFIX}:${intent.userId}:${intent.sourceDomain}:${intent.deduplicationKey}`;
  }

  private rowConsumer(
    receiptKey: string,
    channel: NotificationChannel,
  ): string {
    return `${ROW_CONSUMER}:${receiptKey}:${channel}`;
  }
}
