import { Module } from '@nestjs/common';
import { LogosModule } from '@personal-os/logos';
import { FinanceEventsModule } from '../events/events.module';
import { FinanceFxModule } from '../fx/fx.module';
import { FinanceOwnershipModule } from '../shared/finance-ownership.module';
import { SUBSCRIPTION_MATCHER } from '../shared/application/tokens';
import { SubscriptionRemindersService } from './application/subscription-reminders.service';
import { SubscriptionsService } from './application/subscriptions.service';
import { SubscriptionRemindersScheduler } from './infrastructure/subscription-reminders.scheduler';
import { SubscriptionsRepository } from './infrastructure/subscriptions.repository';
import { SubscriptionsController } from './presentation/subscriptions.controller';

@Module({
  imports: [
    LogosModule,
    FinanceOwnershipModule,
    FinanceFxModule,
    FinanceEventsModule,
  ],
  controllers: [SubscriptionsController],
  providers: [
    SubscriptionsRepository,
    SubscriptionsService,
    SubscriptionRemindersService,
    SubscriptionRemindersScheduler,
    {
      provide: SUBSCRIPTION_MATCHER,
      useExisting: SubscriptionsService,
    },
  ],
  exports: [
    SubscriptionsService,
    SubscriptionsRepository,
    SUBSCRIPTION_MATCHER,
  ],
})
export class FinanceSubscriptionsModule {}
