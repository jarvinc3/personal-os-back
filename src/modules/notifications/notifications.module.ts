import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmailSyncProcessor } from '../../shared/processors/email-sync.processor';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsProcessor } from './notifications.processor';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';
import { PushTokensService } from './push-tokens.service';

@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsRepository,
    NotificationsService,
    NotificationsGateway,
    PushTokensService,
    NotificationsProcessor,
    EmailSyncProcessor,
  ],
  exports: [NotificationsService, NotificationsGateway, PushTokensService],
})
export class NotificationsModule {}
