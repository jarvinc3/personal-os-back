import { Inject, Injectable } from '@nestjs/common';
import type {
  DataBranchDescriptor,
  UserDataWipeDomainsPort,
} from '@personal-os/users';
import {
  DATA_BRANCH_WIPERS,
  type DataBranchWiper,
  type WipeDataBranchesOptions,
} from './data-branch-wiper';

interface WiperResultReader {
  (wiper: DataBranchWiper): Promise<Record<string, number>>;
}

@Injectable()
export class UserDataWipeDomainsAdapter implements UserDataWipeDomainsPort {
  constructor(
    @Inject(DATA_BRANCH_WIPERS)
    private readonly wipers: readonly DataBranchWiper[],
  ) {}

  dataBranches(): readonly DataBranchDescriptor[] {
    return this.wipers.flatMap((wiper) => wiper.dataBranches());
  }

  countDataBranches(
    userId: string,
    branchIds: readonly string[],
  ): Promise<Record<string, number>> {
    return this.collectResults((wiper) =>
      wiper.countDataBranches(userId, branchIds),
    );
  }

  wipeDataBranches(
    userId: string,
    branchIds: readonly string[],
    options?: WipeDataBranchesOptions,
  ): Promise<Record<string, number>> {
    return this.collectResults((wiper) =>
      wiper.wipeDataBranches(userId, branchIds, options),
    );
  }

  private async collectResults(
    readResults: WiperResultReader,
  ): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const wiper of this.wipers) {
      Object.assign(counts, await readResults(wiper));
    }
    return counts;
  }
}
