import { Injectable } from '@nestjs/common';
import {
  AI_DATA_BRANCHES,
  AiInferenceDataService,
} from '@personal-os/intelligence';
import type { DataBranchDescriptor } from '@personal-os/users';
import {
  branchDescriptorsFrom,
  runForRequestedBranch,
  type DataBranchWiper,
} from '../data-branch-wiper';

const AI_INFERENCES_BRANCH = 'ai.inferences';

@Injectable()
export class AiInferenceDataBranchWiper implements DataBranchWiper {
  constructor(private readonly inferences: AiInferenceDataService) {}

  dataBranches(): readonly DataBranchDescriptor[] {
    return branchDescriptorsFrom(AI_DATA_BRANCHES, AI_INFERENCES_BRANCH);
  }

  countDataBranches(
    userId: string,
    branchIds: readonly string[],
  ): Promise<Record<string, number>> {
    return runForRequestedBranch(AI_INFERENCES_BRANCH, branchIds, () =>
      this.inferences.countForUser(userId),
    );
  }

  wipeDataBranches(
    userId: string,
    branchIds: readonly string[],
  ): Promise<Record<string, number>> {
    return runForRequestedBranch(AI_INFERENCES_BRANCH, branchIds, () =>
      this.inferences.wipeForUser(userId),
    );
  }
}
