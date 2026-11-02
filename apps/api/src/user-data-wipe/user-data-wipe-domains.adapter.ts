import { Injectable } from '@nestjs/common';
import {
  AI_DATA_BRANCHES,
  AiConversationDataService,
  AiInferenceDataService,
} from '@personal-os/ai-agent';
import { FinanceFacade, isFinanceDataBranch } from '@personal-os/finance';
import {
  NOTIFICATIONS_DATA_BRANCHES,
  NotificationsService,
} from '@personal-os/notifications';
import type {
  DataBranchDescriptor,
  UserDataWipeDomainsPort,
} from '@personal-os/users';
@Injectable()
export class UserDataWipeDomainsAdapter implements UserDataWipeDomainsPort {
  constructor(
    private readonly finance: FinanceFacade,
    private readonly notifications: NotificationsService,
    private readonly ai: AiInferenceDataService,
    private readonly aiConversations: AiConversationDataService,
  ) {}
  dataBranches(): readonly DataBranchDescriptor[] {
    return [
      ...this.finance.dataBranches(),
      ...AI_DATA_BRANCHES,
      ...NOTIFICATIONS_DATA_BRANCHES,
    ];
  }
  async countDataBranches(
    userId: string,
    branchIds: readonly string[],
  ): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    const financeIds = branchIds.filter(isFinanceDataBranch);
    if (financeIds.length > 0) {
      Object.assign(
        counts,
        await this.finance.countUserDataBranches(userId, financeIds),
      );
    }
    const notificationIds = branchIds.filter((id) =>
      id.startsWith('notifications.'),
    );
    if (notificationIds.length > 0) {
      const all = await this.notifications.countForUser(userId);
      for (const id of notificationIds) {
        counts[id] = all[id] ?? 0;
      }
    }
    if (branchIds.includes('ai.inferences')) {
      counts['ai.inferences'] = await this.ai.countForUser(userId);
    }
    if (branchIds.includes('ai.conversations')) {
      counts['ai.conversations'] =
        await this.aiConversations.countForUser(userId);
    }
    return counts;
  }
  async wipeDataBranches(
    userId: string,
    branchIds: readonly string[],
    options?: {
      balanceInstitutionId?: string;
    },
  ): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    const financeIds = branchIds.filter(isFinanceDataBranch);
    if (financeIds.length > 0) {
      Object.assign(
        counts,
        await this.finance.wipeUserDataBranches(userId, financeIds, options),
      );
    }
    const notificationIds = branchIds.filter((id) =>
      id.startsWith('notifications.'),
    );
    if (notificationIds.length > 0) {
      Object.assign(
        counts,
        await this.notifications.wipeAllForUser(userId, notificationIds),
      );
    }
    if (branchIds.includes('ai.inferences')) {
      counts['ai.inferences'] = await this.ai.wipeForUser(userId);
    }
    if (branchIds.includes('ai.conversations')) {
      counts['ai.conversations'] =
        await this.aiConversations.wipeForUser(userId);
    }
    return counts;
  }
}
