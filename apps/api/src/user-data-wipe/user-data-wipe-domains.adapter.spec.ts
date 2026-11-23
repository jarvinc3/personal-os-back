import { DATA_APP, type DataBranchDescriptor } from '@personal-os/users';
import type { DataBranchWiper } from './data-branch-wiper';
import { UserDataWipeDomainsAdapter } from './user-data-wipe-domains.adapter';

function descriptor(
  id: string,
  app: DataBranchDescriptor['app'],
  order: number,
): DataBranchDescriptor {
  return {
    id,
    app,
    label: id,
    includes: [],
    order,
  };
}

function wiper(overrides: Partial<DataBranchWiper>): DataBranchWiper {
  return {
    dataBranches: () => [],
    countDataBranches: () => Promise.resolve({}),
    wipeDataBranches: () => Promise.resolve({}),
    ...overrides,
  };
}

describe('UserDataWipeDomainsAdapter', () => {
  const financeBranch = descriptor('finance.transactions', DATA_APP.FINANCE, 1);
  const aiBranch = descriptor('ai.inferences', DATA_APP.AI, 3);
  const notificationsBranch = descriptor(
    'notifications.history',
    DATA_APP.NOTIFICATIONS,
    1,
  );

  it('concatenates the branches each wiper declares', () => {
    const adapter = new UserDataWipeDomainsAdapter([
      wiper({ dataBranches: () => [financeBranch] }),
      wiper({ dataBranches: () => [aiBranch] }),
      wiper({ dataBranches: () => [notificationsBranch] }),
    ]);

    expect(adapter.dataBranches()).toEqual([
      financeBranch,
      aiBranch,
      notificationsBranch,
    ]);
  });

  it('merges the counts each wiper returns for the requested branches', async () => {
    const branchIds = [financeBranch.id, aiBranch.id];
    const adapter = new UserDataWipeDomainsAdapter([
      wiper({
        countDataBranches: () => Promise.resolve({ [financeBranch.id]: 2 }),
      }),
      wiper({
        countDataBranches: () => Promise.resolve({ [aiBranch.id]: 5 }),
      }),
      wiper({ countDataBranches: () => Promise.resolve({}) }),
    ]);

    await expect(
      adapter.countDataBranches('user-1', branchIds),
    ).resolves.toEqual({
      [financeBranch.id]: 2,
      [aiBranch.id]: 5,
    });
  });

  it('passes the wipe options to every wiper and merges the result', async () => {
    const branchIds = [financeBranch.id, notificationsBranch.id];
    const financeWipe = jest.fn().mockResolvedValue({
      [financeBranch.id]: 2,
    });
    const notificationsWipe = jest.fn().mockResolvedValue({
      [notificationsBranch.id]: 4,
    });
    const adapter = new UserDataWipeDomainsAdapter([
      wiper({ wipeDataBranches: financeWipe }),
      wiper({ wipeDataBranches: notificationsWipe }),
    ]);

    await expect(
      adapter.wipeDataBranches('user-1', branchIds, {
        balanceInstitutionId: 'institution-1',
      }),
    ).resolves.toEqual({
      [financeBranch.id]: 2,
      [notificationsBranch.id]: 4,
    });
    expect(financeWipe).toHaveBeenCalledWith('user-1', branchIds, {
      balanceInstitutionId: 'institution-1',
    });
    expect(notificationsWipe).toHaveBeenCalledWith('user-1', branchIds, {
      balanceInstitutionId: 'institution-1',
    });
  });
});
