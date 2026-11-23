import type { DataBranchDescriptor } from '@personal-os/users';

export const DATA_BRANCH_WIPERS = Symbol.for(
  'personal-os.api.data-branch-wipers',
);

export type WipeDataBranchesOptions = {
  balanceInstitutionId?: string;
};

export type DataBranchWiper = {
  dataBranches(): readonly DataBranchDescriptor[];
  countDataBranches(
    userId: string,
    branchIds: readonly string[],
  ): Promise<Record<string, number>>;
  wipeDataBranches(
    userId: string,
    branchIds: readonly string[],
    options?: WipeDataBranchesOptions,
  ): Promise<Record<string, number>>;
};

export interface BranchRun {
  (): Promise<number>;
}

export function branchDescriptorsFrom(
  descriptors: readonly DataBranchDescriptor[],
  branchId: string,
): readonly DataBranchDescriptor[] {
  return descriptors.filter((descriptor) => {
    return descriptor.id === branchId;
  });
}

export async function runForRequestedBranch(
  branchId: string,
  requestedIds: readonly string[],
  run: BranchRun,
): Promise<Record<string, number>> {
  const isRequested = requestedIds.includes(branchId);
  if (!isRequested) {
    return {};
  }

  return { [branchId]: await run() };
}
