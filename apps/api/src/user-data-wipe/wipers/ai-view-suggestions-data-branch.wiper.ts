import { Injectable } from '@nestjs/common';
import {
  AI_DATA_BRANCHES,
  ViewSuggestionDataService,
} from '@personal-os/intelligence';
import type { DataBranchDescriptor } from '@personal-os/users';
import {
  branchDescriptorsFrom,
  runForRequestedBranch,
  type DataBranchWiper,
} from '../data-branch-wiper';

const AI_VIEW_SUGGESTIONS_BRANCH = 'ai.viewSuggestions';

@Injectable()
export class AiViewSuggestionsDataBranchWiper implements DataBranchWiper {
  constructor(private readonly suggestions: ViewSuggestionDataService) {}

  dataBranches(): readonly DataBranchDescriptor[] {
    return branchDescriptorsFrom(AI_DATA_BRANCHES, AI_VIEW_SUGGESTIONS_BRANCH);
  }

  countDataBranches(
    userId: string,
    branchIds: readonly string[],
  ): Promise<Record<string, number>> {
    return runForRequestedBranch(AI_VIEW_SUGGESTIONS_BRANCH, branchIds, () =>
      this.suggestions.countForUser(userId),
    );
  }

  wipeDataBranches(
    userId: string,
    branchIds: readonly string[],
  ): Promise<Record<string, number>> {
    return runForRequestedBranch(AI_VIEW_SUGGESTIONS_BRANCH, branchIds, () =>
      this.suggestions.wipeForUser(userId),
    );
  }
}
