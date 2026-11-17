import { Global, Module } from '@nestjs/common';
import { NOTIFICATION_INTENT_SINK } from '@personal-os/contracts';
import { NotificationIntentPipeline } from './application/notification-intent.pipeline';
import { NotificationsModule } from './notifications.module';

/**
 * Makes the intent sink injectable by producer domains, so they depend on the
 * contracts token and never on Notifications. Import it once from the app.
 */
@Global()
@Module({
  imports: [NotificationsModule],
  providers: [
    {
      provide: NOTIFICATION_INTENT_SINK,
      useExisting: NotificationIntentPipeline,
    },
  ],
  exports: [NOTIFICATION_INTENT_SINK],
})
export class NotificationIntentModule {}
