import { Global, Module } from '@nestjs/common';
import { FinanceModule } from '@personal-os/finance';
import { AiModule } from '@personal-os/intelligence';
import { NotificationsModule } from '@personal-os/notifications';
import { USER_DATA_WIPE_DOMAINS } from '@personal-os/users';
import { DATA_BRANCH_WIPERS, type DataBranchWiper } from './data-branch-wiper';
import { UserDataWipeDomainsAdapter } from './user-data-wipe-domains.adapter';
import { AiActionsDataBranchWiper } from './wipers/ai-actions-data-branch.wiper';
import { AiConversationDataBranchWiper } from './wipers/ai-conversation-data-branch.wiper';
import { AiInferenceDataBranchWiper } from './wipers/ai-inference-data-branch.wiper';
import { AiViewSuggestionsDataBranchWiper } from './wipers/ai-view-suggestions-data-branch.wiper';
import { FinanceDataBranchWiper } from './wipers/finance-data-branch.wiper';
import { NotificationsDataBranchWiper } from './wipers/notifications-data-branch.wiper';

const DATA_BRANCH_WIPER_PROVIDERS = [
  FinanceDataBranchWiper,
  NotificationsDataBranchWiper,
  AiConversationDataBranchWiper,
  AiInferenceDataBranchWiper,
  AiActionsDataBranchWiper,
  AiViewSuggestionsDataBranchWiper,
];

@Global()
@Module({
  imports: [AiModule, FinanceModule, NotificationsModule],
  providers: [
    ...DATA_BRANCH_WIPER_PROVIDERS,
    {
      provide: DATA_BRANCH_WIPERS,
      useFactory: (...wipers: DataBranchWiper[]): readonly DataBranchWiper[] =>
        wipers,
      inject: DATA_BRANCH_WIPER_PROVIDERS,
    },
    {
      provide: USER_DATA_WIPE_DOMAINS,
      useClass: UserDataWipeDomainsAdapter,
    },
  ],
  exports: [USER_DATA_WIPE_DOMAINS],
})
export class UserDataWipeModule {}
