/**
 * Data branches: the unit the self-service wipe works with. Every app declares
 * its own, so adding one does not touch the orchestrator.
 *
 * The identifier (`<app>.<branch>`) is part of the HTTP contract: it is not
 * renamed without an issue.
 */
export const DATA_APP = {
  FINANCE: 'finance',
  AI: 'ai',
  NOTIFICATIONS: 'notifications',
  SETTINGS: 'settings',
} as const;

export type DataApp = (typeof DATA_APP)[keyof typeof DATA_APP];

export type DataBranchDescriptor = {
  id: string;
  app: DataApp;
  label: string;
  /** Branches that run with this one, because they depend on it. */
  includes: readonly string[];
  /** Execution order inside the app; lower runs first. */
  order: number;
};

export type DataBranchCount = {
  id: string;
  label: string;
  count: number;
  includes: Array<{ id: string; count: number }>;
};

export type DataAppBranches = {
  app: DataApp;
  branches: DataBranchCount[];
};

const APP_ORDER: readonly DataApp[] = [
  DATA_APP.FINANCE,
  DATA_APP.AI,
  DATA_APP.NOTIFICATIONS,
  DATA_APP.SETTINGS,
];

function byAppOrderAndOrder(
  left: DataBranchDescriptor,
  right: DataBranchDescriptor,
): number {
  const appDelta = APP_ORDER.indexOf(left.app) - APP_ORDER.indexOf(right.app);
  return appDelta === 0 ? left.order - right.order : appDelta;
}

/** Selected branches plus everything they drag, in execution order. */
export function expandDataBranches(
  descriptors: readonly DataBranchDescriptor[],
  requested: readonly string[],
): DataBranchDescriptor[] {
  const byId = new Map(descriptors.map((branch) => [branch.id, branch]));
  const expanded = new Set<string>();
  const visit = (id: string) => {
    if (expanded.has(id)) {
      return;
    }
    const branch = byId.get(id);
    if (!branch) {
      return;
    }
    expanded.add(id);
    for (const included of branch.includes) {
      visit(included);
    }
  };
  for (const id of requested) {
    visit(id);
  }
  return [...expanded]
    .flatMap((id) => {
      const branch = byId.get(id);
      return branch ? [branch] : [];
    })
    .sort(byAppOrderAndOrder);
}

export function isKnownDataBranch(
  descriptors: readonly DataBranchDescriptor[],
  id: string,
): boolean {
  return descriptors.some((branch) => branch.id === id);
}

/** Branches grouped by app, each with its count and what it drags. */
export function groupDataBranchCounts(
  descriptors: readonly DataBranchDescriptor[],
  counts: Readonly<Record<string, number>>,
): DataAppBranches[] {
  const byId = new Map(descriptors.map((branch) => [branch.id, branch]));
  const groups = new Map<DataApp, DataBranchCount[]>();
  for (const branch of [...descriptors].sort(byAppOrderAndOrder)) {
    const group = groups.get(branch.app) ?? [];
    group.push({
      id: branch.id,
      label: branch.label,
      count: counts[branch.id] ?? 0,
      includes: branch.includes.flatMap((included) => {
        const includedBranch = byId.get(included);
        return includedBranch
          ? [{ id: included, count: counts[included] ?? 0 }]
          : [];
      }),
    });
    groups.set(branch.app, group);
  }
  return [...groups.entries()].map(([app, branches]) => ({ app, branches }));
}
