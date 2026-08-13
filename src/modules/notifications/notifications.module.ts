import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { FinanceEventsModule } from '../finance';
import { NotificationPolicyService } from './application/notification-policy.service';
import { NotificationsEventsListener } from './application/notifications-events.listener';
import { NotificationsProcessor } from './application/notifications.processor';
import { NotificationsService } from './application/notifications.service';
import { PushTokensService } from './application/push-tokens.service';
import { EmailSyncProcessor } from './infrastructure/email-sync.processor';
import { NotificationsRepository } from './infrastructure/notifications.repository';
import { PushSenderService } from './infrastructure/push-sender.service';
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
