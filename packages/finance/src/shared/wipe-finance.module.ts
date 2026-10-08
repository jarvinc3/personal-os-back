import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { isBullMqEnabledFromProcessEnv } from '@personal-os/config';
import { QueueNames } from '@personal-os/core';
import { LogosModule } from '@personal-os/logos';
import { WipeFinanceUserDataUseCase } from './application/wipe-finance-user-data.use-case';

const bullMqEnabled = isBullMqEnabledFromProcessEnv();

@Module({
  imports: [
    LogosModule,
    ...(bullMqEnabled
      ? [BullModule.registerQueue({ name: QueueNames.GMAIL_SYNC })]
      : []),
  ],
  providers: [WipeFinanceUserDataUseCase],
  exports: [WipeFinanceUserDataUseCase],
})
export class FinanceWipeModule {}
