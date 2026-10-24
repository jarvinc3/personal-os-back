import { Injectable } from '@nestjs/common';
import { AiSessionsService } from '@personal-os/ai-agent';
import { AI_DATA_BRANCHES } from '@personal-os/ai-agent';
import { FinanceFacade, isFinanceDataBranch } from '@personal-os/finance';
import {
  NOTIFICATIONS_DATA_BRANCHES,
  NotificationsService,
} from '@personal-os/notifications';
import type {
  DataBranchDescriptor,
  UserDataWipeDomainsPort,
} from '@personal-os/users';

const AI_BRANCH = 'ai.sessions';

@Injectable()
export class UserDataWipeDomainsAdapter implements UserDataWipeDomainsPort {
  constructor(
    private readonly finance: FinanceFacade,
    private readonly aiSessions: AiSessionsService,
    private readonly notifications: NotificationsService,
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
    if (branchIds.includes(AI_BRANCH)) {
      Object.assign(counts, await this.aiSessions.countForUser(userId));
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
    return counts;
  }

  async wipeDataBranches(
    userId: string,
    branchIds: readonly string[],
    options?: { balanceInstitutionId?: string },
  ): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    const financeIds = branchIds.filter(isFinanceDataBranch);
    if (financeIds.length > 0) {
      Object.assign(
        counts,
        await this.finance.wipeUserDataBranches(userId, financeIds, options),
      );
    }
    if (branchIds.includes(AI_BRANCH)) {
      Object.assign(counts, await this.aiSessions.wipeAllForUser(userId));
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
    return counts;
  }
}
