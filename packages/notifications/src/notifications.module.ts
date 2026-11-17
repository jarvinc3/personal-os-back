import { Module } from '@nestjs/common';
import { AuthModule } from '@personal-os/auth';
import { NOTIFICATION_INTENT_CONSUMER } from '@personal-os/contracts';
import { DomainEventsModule } from '@personal-os/core';
import { NotificationIntentReceiver } from './application/notification-intent.receiver';
import { NotificationPolicyService } from './application/notification-policy.service';
import { NotificationsEventsListener } from './application/notifications-events.listener';
import { NotificationsProcessor } from './application/notifications.processor';
import { NotificationsService } from './application/notifications.service';
import { PushTokensService } from './application/push-tokens.service';
import { EMAIL_SENDER } from './application/tokens';
import { EmailSyncProcessor } from './infrastructure/email-sync.processor';
import { NotificationsRepository } from './infrastructure/notifications.repository';
import { FcmPushService } from './infrastructure/fcm-push.service';
import { PushSenderService } from './infrastructure/push-sender.service';
import { ResendEmailAdapter } from './infrastructure/resend-email.adapter';
import { NotificationsController } from './presentation/notifications.controller';
import { NotificationsGateway } from './presentation/notifications.gateway';

@Module({
  imports: [AuthModule, DomainEventsModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsRepository,
    NotificationPolicyService,
    NotificationIntentReceiver,
    {
      provide: NOTIFICATION_INTENT_CONSUMER,
      useExisting: NotificationIntentReceiver,
    },
    NotificationsService,
    NotificationsEventsListener,
    NotificationsGateway,
    PushTokensService,
    PushSenderService,
    FcmPushService,
    ResendEmailAdapter,
    {
      provide: EMAIL_SENDER,
      useExisting: ResendEmailAdapter,
    },
    NotificationsProcessor,
    EmailSyncProcessor,
  ],
  exports: [
    NotificationsService,
    NotificationsGateway,
    PushTokensService,
    NotificationPolicyService,
    NotificationIntentReceiver,
    NOTIFICATION_INTENT_CONSUMER,
  ],
})
export class NotificationsModule {}
