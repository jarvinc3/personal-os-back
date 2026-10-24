import { Global, Module } from '@nestjs/common';
import { AiModule } from '@personal-os/ai-agent';
import { FinanceModule } from '@personal-os/finance';
import { NotificationsModule } from '@personal-os/notifications';
import { USER_DATA_WIPE_DOMAINS } from '@personal-os/users';
import { UserDataWipeDomainsAdapter } from './user-data-wipe-domains.adapter';
@Global()
@Module({
  imports: [AiModule, FinanceModule, NotificationsModule],
  providers: [
    {
      provide: USER_DATA_WIPE_DOMAINS,
      useClass: UserDataWipeDomainsAdapter,
    },
  ],
  exports: [USER_DATA_WIPE_DOMAINS],
})
export class UserDataWipeModule {}
