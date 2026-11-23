import { Injectable } from '@nestjs/common';
import {
  AI_DATA_BRANCHES,
  AiActionsRepository,
} from '@personal-os/intelligence';
import type { DataBranchDescriptor } from '@personal-os/users';
import {
  branchDescriptorsFrom,
  runForRequestedBranch,
  type DataBranchWiper,
} from '../data-branch-wiper';

const AI_ACTIONS_BRANCH = 'ai.actions';

@Injectable()
export class AiActionsDataBranchWiper implements DataBranchWiper {
  constructor(private readonly actions: AiActionsRepository) {}

  dataBranches(): readonly DataBranchDescriptor[] {
    return branchDescriptorsFrom(AI_DATA_BRANCHES, AI_ACTIONS_BRANCH);
  }

  countDataBranches(
    userId: string,
    branchIds: readonly string[],
  ): Promise<Record<string, number>> {
    return runForRequestedBranch(AI_ACTIONS_BRANCH, branchIds, () =>
      this.actions.countForUser(userId),
    );
  }

  wipeDataBranches(
    userId: string,
    branchIds: readonly string[],
  ): Promise<Record<string, number>> {
    return runForRequestedBranch(AI_ACTIONS_BRANCH, branchIds, () =>
      this.actions.wipeForUser(userId),
    );
  }
}
