import { Module } from '@nestjs/common';
import { EmailSyncProcessor } from '../../shared/processors/email-sync.processor';
import { AuthModule } from '../auth/auth.module';
import { FinanceEventsModule } from '../finance/events/events.module';
import { NotificationPolicyService } from './notification-policy.service';
import { NotificationsEventsListener } from './notifications-events.listener';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsProcessor } from './notifications.processor';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';
import { PushSenderService } from './push-sender.service';
import { PushTokensService } from './push-tokens.service';

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
