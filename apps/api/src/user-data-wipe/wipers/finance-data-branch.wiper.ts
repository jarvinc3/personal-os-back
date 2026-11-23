import { Injectable } from '@nestjs/common';
import { FinanceFacade, isFinanceDataBranch } from '@personal-os/finance';
import type { DataBranchDescriptor } from '@personal-os/users';
import type {
  DataBranchWiper,
  WipeDataBranchesOptions,
} from '../data-branch-wiper';

@Injectable()
export class FinanceDataBranchWiper implements DataBranchWiper {
  constructor(private readonly finance: FinanceFacade) {}

  dataBranches(): readonly DataBranchDescriptor[] {
    return this.finance.dataBranches();
  }

  async countDataBranches(
    userId: string,
    branchIds: readonly string[],
  ): Promise<Record<string, number>> {
    const financeIds = branchIds.filter(isFinanceDataBranch);
    if (financeIds.length === 0) {
      return {};
    }
    return this.finance.countUserDataBranches(userId, financeIds);
  }

  async wipeDataBranches(
    userId: string,
    branchIds: readonly string[],
    options?: WipeDataBranchesOptions,
  ): Promise<Record<string, number>> {
    const financeIds = branchIds.filter(isFinanceDataBranch);
    if (financeIds.length === 0) {
      return {};
    }
    return this.finance.wipeUserDataBranches(userId, financeIds, options);
  }
}
