import { Module } from '@nestjs/common';
import { LogosModule } from '@personal-os/logos';
import { WipeFinanceUserDataUseCase } from './application/wipe-finance-user-data.use-case';
@Module({
  imports: [LogosModule],
  providers: [WipeFinanceUserDataUseCase],
  exports: [WipeFinanceUserDataUseCase],
})
export class FinanceWipeModule {}
