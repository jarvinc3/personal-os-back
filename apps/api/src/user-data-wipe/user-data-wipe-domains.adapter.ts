import { Injectable } from '@nestjs/common';
import { AiSessionsService } from '@personal-os/ai-agent';
import { FinanceFacade, isFinanceWipeLayer } from '@personal-os/finance';
import { NotificationsService } from '@personal-os/notifications';
import type { UserDataWipeDomainsPort, WipeLayerId } from '@personal-os/users';

@Injectable()
export class UserDataWipeDomainsAdapter implements UserDataWipeDomainsPort {
  constructor(
    private readonly finance: FinanceFacade,
    private readonly aiSessions: AiSessionsService,
    private readonly notifications: NotificationsService,
  ) {}

  async wipeFinance(
    userId: string,
    layers: readonly WipeLayerId[],
    options?: { balanceInstitutionId?: string },
  ): Promise<Record<string, number>> {
    const financeLayers = layers.filter(isFinanceWipeLayer);
    if (financeLayers.length === 0) {
      return {};
    }
    return this.finance.wipeUserData(userId, financeLayers, options);
  }

  async wipeAi(userId: string): Promise<Record<string, number>> {
    return this.aiSessions.wipeAllForUser(userId);
  }

  async wipeNotifications(userId: string): Promise<Record<string, number>> {
    return this.notifications.wipeAllForUser(userId);
  }
}
