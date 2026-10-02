import { Module } from '@nestjs/common';
import { AuthModule } from '@personal-os/auth';
import { FinanceEventsModule } from '@personal-os/finance';
import { NotificationPolicyService } from './application/notification-policy.service';
import { NotificationsEventsListener } from './application/notifications-events.listener';
import { NotificationsProcessor } from './application/notifications.processor';
import { NotificationsService } from './application/notifications.service';
import { PushTokensService } from './application/push-tokens.service';
import { EMAIL_SENDER } from './application/tokens';
import { EmailSyncProcessor } from './infrastructure/email-sync.processor';
import { NotificationsRepository } from './infrastructure/notifications.repository';
import { PushSenderService } from './infrastructure/push-sender.service';
import { ResendEmailAdapter } from './infrastructure/resend-email.adapter';
import { NotificationsController } from './presentation/notifications.controller';
import { NotificationsGateway } from './presentation/notifications.gateway';

@Module({
  imports: [AuthModule, FinanceEventsModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsRepository,
    NotificationPolicyService,
    NotificationsService,
    NotificationsEventsListener,
    NotificationsGateway,
    PushTokensService,
    PushSenderService,
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
  ],
})
export class NotificationsModule {}
