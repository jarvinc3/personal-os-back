import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmailSyncProcessor } from '../../shared/processors/email-sync.processor';
import { NotificationsController } from './notifications.controller';
import { NotificationsEventsListener } from './notifications-events.listener';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsProcessor } from './notifications.processor';
import { NotificationsRepository } from './notifications.repository';
import { NotificationPolicyService } from './notification-policy.service';
import { NotificationsService } from './notifications.service';
import { PushTokensService } from './push-tokens.service';
import { PushSenderService } from './push-sender.service';

@Module({
  imports: [AuthModule],
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
