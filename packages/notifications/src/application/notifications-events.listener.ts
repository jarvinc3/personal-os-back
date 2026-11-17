import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  AppEvents,
  DomainEventIdempotencyGuard,
  NotificationCreatedEvent,
} from '@personal-os/core';
import { NotificationsGateway } from '../presentation/notifications.gateway';

type AiEmailSyncUpdatedEvent = {
  userId: string;
  state: Record<string, unknown>;
};

/**
 * Platform events only. Producer domains translate their own facts into
 * intents; Notifications never interprets their payloads or copy.
 */
@Injectable()
export class NotificationsEventsListener {
  private readonly logger = new Logger(NotificationsEventsListener.name);
  private static readonly CONSUMER = 'notifications';

  constructor(
    private readonly idempotency: DomainEventIdempotencyGuard,
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  @OnEvent(AppEvents.AI_EMAIL_SYNC_UPDATED)
  onAiEmailSyncUpdated(event: AiEmailSyncUpdatedEvent): void {
    this.notificationsGateway.emitToUser(
      event.userId,
      'ai.email.sync.updated',
      {
        state: event.state,
      },
    );
  }

  @OnEvent(AppEvents.NOTIFICATION_CREATED)
  onNotificationCreated(event: NotificationCreatedEvent): void {
    this.logger.debug(
      `event=notification.created handled=true notificationId=${event.notificationId} userId=${event.userId}`,
    );
  }

  @OnEvent(AppEvents.USER_DATA_WIPED)
  async onUserDataWiped(event: {
    eventId?: string;
    userId: string;
  }): Promise<void> {
    // The wipe already removed notifications; claim only, never create any.
    await this.idempotency.tryClaim(
      event.eventId,
      `${NotificationsEventsListener.CONSUMER}:data-wiped`,
    );
  }
}
