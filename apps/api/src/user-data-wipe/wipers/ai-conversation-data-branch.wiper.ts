import { Injectable } from '@nestjs/common';
import {
  AI_DATA_BRANCHES,
  AiConversationDataService,
} from '@personal-os/intelligence';
import type { DataBranchDescriptor } from '@personal-os/users';
import {
  branchDescriptorsFrom,
  runForRequestedBranch,
  type DataBranchWiper,
} from '../data-branch-wiper';

const AI_CONVERSATIONS_BRANCH = 'ai.conversations';

@Injectable()
export class AiConversationDataBranchWiper implements DataBranchWiper {
  constructor(private readonly conversations: AiConversationDataService) {}

  dataBranches(): readonly DataBranchDescriptor[] {
    return branchDescriptorsFrom(AI_DATA_BRANCHES, AI_CONVERSATIONS_BRANCH);
  }

  countDataBranches(
    userId: string,
    branchIds: readonly string[],
  ): Promise<Record<string, number>> {
    return runForRequestedBranch(AI_CONVERSATIONS_BRANCH, branchIds, () =>
      this.conversations.countForUser(userId),
    );
  }

  wipeDataBranches(
    userId: string,
    branchIds: readonly string[],
  ): Promise<Record<string, number>> {
    return runForRequestedBranch(AI_CONVERSATIONS_BRANCH, branchIds, () =>
      this.conversations.wipeForUser(userId),
    );
  }
}
