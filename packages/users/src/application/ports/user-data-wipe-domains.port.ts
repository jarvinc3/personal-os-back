import type { WipeLayerId } from '../../domain/wipe-layers';

export const USER_DATA_WIPE_DOMAINS = 'USER_DATA_WIPE_DOMAINS' as const;

/**
 * Bridges the users orchestrator to domain packages without importing them:
 * UsersModule is global and finance/ai/notifications already depend on it, so a
 * direct dependency would close a module cycle.
 */
export interface UserDataWipeDomainsPort {
  wipeFinance(
    userId: string,
    layers: readonly WipeLayerId[],
  ): Promise<Record<string, number>>;
  wipeAi(userId: string): Promise<Record<string, number>>;
  wipeNotifications(userId: string): Promise<Record<string, number>>;
}
