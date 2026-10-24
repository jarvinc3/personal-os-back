import type { DataBranchDescriptor } from '../../domain/data-branches';

export const USER_DATA_WIPE_DOMAINS = 'USER_DATA_WIPE_DOMAINS' as const;

/**
 * Bridges the users orchestrator to domain packages without importing them:
 * UsersModule is global and finance/ai/notifications already depend on it, so a
 * direct dependency would close a module cycle.
 */
export interface UserDataWipeDomainsPort {
  /** Branches declared by the apps that own data. */
  dataBranches(): readonly DataBranchDescriptor[];
  countDataBranches(
    userId: string,
    branchIds: readonly string[],
  ): Promise<Record<string, number>>;
  wipeDataBranches(
    userId: string,
    branchIds: readonly string[],
    options?: { balanceInstitutionId?: string },
  ): Promise<Record<string, number>>;
}
