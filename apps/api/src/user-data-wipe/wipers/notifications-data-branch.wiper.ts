import { Injectable } from '@nestjs/common';
import {
  NOTIFICATIONS_DATA_BRANCHES,
  NotificationsService,
} from '@personal-os/notifications';
import { DATA_APP, type DataBranchDescriptor } from '@personal-os/users';
import type { DataBranchWiper } from '../data-branch-wiper';

const NOTIFICATIONS_BRANCH_PREFIX = `${DATA_APP.NOTIFICATIONS}.`;

@Injectable()
export class NotificationsDataBranchWiper implements DataBranchWiper {
  constructor(private readonly notifications: NotificationsService) {}

  dataBranches(): readonly DataBranchDescriptor[] {
    return NOTIFICATIONS_DATA_BRANCHES;
  }

  async countDataBranches(
    userId: string,
    branchIds: readonly string[],
  ): Promise<Record<string, number>> {
    const notificationIds = this.notificationIds(branchIds);
    if (notificationIds.length === 0) {
      return {};
    }
    const all = await this.notifications.countForUser(userId);
    return Object.fromEntries(notificationIds.map((id) => [id, all[id] ?? 0]));
  }

  async wipeDataBranches(
    userId: string,
    branchIds: readonly string[],
  ): Promise<Record<string, number>> {
    const notificationIds = this.notificationIds(branchIds);
    if (notificationIds.length === 0) {
      return {};
    }
    return this.notifications.wipeAllForUser(userId, notificationIds);
  }

  private notificationIds(branchIds: readonly string[]): string[] {
    return branchIds.filter((id) => id.startsWith(NOTIFICATIONS_BRANCH_PREFIX));
  }
}
