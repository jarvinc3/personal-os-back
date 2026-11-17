import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { ModuleSettingsRegistry } from '@personal-os/contracts';
import { AppEvents } from '@personal-os/core';
import { DATA_APP, type DataBranchDescriptor } from '../domain/data-branches';
import type { UserDataWipeDomainsPort } from './ports/user-data-wipe-domains.port';
import type { UsersRepositoryPort } from './ports/users.repository.port';
import { WipeUserDataUseCase } from './wipe-user-data.use-case';

const BRANCHES: readonly DataBranchDescriptor[] = [
  {
    id: 'finance.reconciliations',
    app: DATA_APP.FINANCE,
    label: 'Conciliaciones',
    includes: [],
    order: 1,
  },
  {
    id: 'finance.transactions',
    app: DATA_APP.FINANCE,
    label: 'Movimientos',
    includes: ['finance.reconciliations'],
    order: 2,
  },
  {
    id: 'finance.balances',
    app: DATA_APP.FINANCE,
    label: 'Saldos a cero',
    includes: [],
    order: 3,
  },
  {
    id: 'ai.sessions',
    app: DATA_APP.AI,
    label: 'Sesiones',
    includes: [],
    order: 1,
  },
  {
    id: 'notifications.history',
    app: DATA_APP.NOTIFICATIONS,
    label: 'Notificaciones',
    includes: [],
    order: 1,
  },
];

function build() {
  const findById = jest.fn();
  const resetSettingsToDefaults = jest.fn();
  const usersRepository = {
    findById,
    resetSettingsToDefaults,
  } as unknown as UsersRepositoryPort;

  const dataBranches = jest.fn().mockReturnValue(BRANCHES);
  const countDataBranches = jest.fn().mockResolvedValue({
    'finance.reconciliations': 1,
    'finance.transactions': 4,
    'finance.balances': 2,
    'ai.sessions': 3,
    'notifications.history': 5,
  });
  const wipeDataBranches = jest.fn().mockResolvedValue({});
  const domains = {
    dataBranches,
    countDataBranches,
    wipeDataBranches,
  } as unknown as UserDataWipeDomainsPort;

  const emit = jest.fn();
  const eventEmitter = { emit } as unknown as EventEmitter2;
  const moduleDefaults = [
    { slug: 'finance', defaults: { version: 2, notifications: {} } },
  ];
  const settingsRegistry = {
    list: () => moduleDefaults,
  } as unknown as ModuleSettingsRegistry;
  const useCase = new WipeUserDataUseCase(
    usersRepository,
    domains,
    eventEmitter,
    settingsRegistry,
  );

  return {
    useCase,
    findById,
    resetSettingsToDefaults,
    moduleDefaults,
    dataBranches,
    countDataBranches,
    wipeDataBranches,
    emit,
  };
}

function userWithFinance() {
  return {
    id: 'user-1',
    preferences: {},
    userModules: [{ isEnabled: true, module: { slug: 'finance' } }],
  };
}

describe('WipeUserDataUseCase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws when the user does not exist', async () => {
    const harness = build();
    harness.findById.mockResolvedValue(null);

    await expect(
      harness.useCase.execute('missing', ['ai.sessions']),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(harness.wipeDataBranches).not.toHaveBeenCalled();
  });

  it('expands the branches with what they drag, in order', async () => {
    const harness = build();
    harness.findById.mockResolvedValue(userWithFinance());

    const wipeResult = await harness.useCase.execute('user-1', [
      'finance.transactions',
    ]);

    expect(harness.wipeDataBranches).toHaveBeenCalledWith(
      'user-1',
      ['finance.reconciliations', 'finance.transactions'],
      undefined,
    );
    expect(wipeResult.appliedBranches).toEqual([
      'finance.reconciliations',
      'finance.transactions',
    ]);
  });

  it('forwards the institution scope only when balances are selected', async () => {
    const harness = build();
    harness.findById.mockResolvedValue(userWithFinance());

    await harness.useCase.execute('user-1', ['finance.balances'], {
      balanceInstitutionId: 'inst-1',
    });
    await harness.useCase.execute('user-1', ['finance.transactions'], {
      balanceInstitutionId: 'inst-1',
    });

    expect(harness.wipeDataBranches).toHaveBeenNthCalledWith(
      1,
      'user-1',
      ['finance.balances'],
      { balanceInstitutionId: 'inst-1' },
    );
    expect(harness.wipeDataBranches).toHaveBeenNthCalledWith(
      2,
      'user-1',
      ['finance.reconciliations', 'finance.transactions'],
      undefined,
    );
  });

  it('does not touch finance when only AI sessions are requested', async () => {
    const harness = build();
    harness.findById.mockResolvedValue(userWithFinance());
    harness.wipeDataBranches.mockResolvedValue({ 'ai.sessions': 3 });

    const wipeResult = await harness.useCase.execute('user-1', ['ai.sessions']);

    expect(harness.wipeDataBranches).toHaveBeenCalledWith(
      'user-1',
      ['ai.sessions'],
      undefined,
    );
    expect(wipeResult.counts).toEqual({ 'ai.sessions': 3 });
  });

  it('resets settings only when asked', async () => {
    const harness = build();
    harness.findById.mockResolvedValue(userWithFinance());

    await harness.useCase.execute('user-1', ['ai.sessions']);
    expect(harness.resetSettingsToDefaults).not.toHaveBeenCalled();

    await harness.useCase.execute('user-1', ['settings.defaults']);
    expect(harness.resetSettingsToDefaults).toHaveBeenCalledWith(
      'user-1',
      harness.moduleDefaults,
    );
  });

  it('rejects a branch that does not exist', async () => {
    const harness = build();
    harness.findById.mockResolvedValue(userWithFinance());

    await expect(
      harness.useCase.execute('user-1', ['finance.unknown']),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(harness.wipeDataBranches).not.toHaveBeenCalled();
  });

  it('keeps finance out when the app is disabled', async () => {
    const harness = build();
    harness.findById.mockResolvedValue({
      id: 'user-1',
      preferences: {},
      userModules: [],
    });

    await expect(
      harness.useCase.execute('user-1', ['finance.transactions']),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stops without deleting when a count changed', async () => {
    const harness = build();
    harness.findById.mockResolvedValue(userWithFinance());

    await expect(
      harness.useCase.execute('user-1', ['finance.transactions'], {
        expectedCounts: { 'finance.transactions': 3 },
      }),
    ).rejects.toMatchObject({
      response: { counts: { 'finance.transactions': 4 } },
    });
    expect(harness.wipeDataBranches).not.toHaveBeenCalled();
  });

  it('wipes when the counts match what the user saw', async () => {
    const harness = build();
    harness.findById.mockResolvedValue(userWithFinance());
    harness.wipeDataBranches.mockResolvedValue({
      'finance.reconciliations': 1,
      'finance.transactions': 4,
    });

    const wipeResult = await harness.useCase.execute(
      'user-1',
      ['finance.transactions'],
      {
        expectedCounts: { 'finance.transactions': 4 },
      },
    );

    expect(wipeResult.counts).toEqual({
      'finance.reconciliations': 1,
      'finance.transactions': 4,
    });
  });

  it('emits a single aggregated event with the applied branches', async () => {
    const harness = build();
    harness.findById.mockResolvedValue(userWithFinance());

    await harness.useCase.execute('user-1', ['ai.sessions']);

    expect(harness.emit).toHaveBeenCalledTimes(1);
    expect(harness.emit).toHaveBeenCalledWith(
      AppEvents.USER_DATA_WIPED,
      expect.objectContaining({
        userId: 'user-1',
        requestedBranches: ['ai.sessions'],
        appliedBranches: ['ai.sessions'],
      }),
    );
  });

  it('lists the branches grouped by app with their counts', async () => {
    const harness = build();
    harness.findById.mockResolvedValue(userWithFinance());

    const groups = await harness.useCase.listBranches('user-1');

    expect(groups.map((group) => group.app)).toEqual([
      DATA_APP.FINANCE,
      DATA_APP.AI,
      DATA_APP.NOTIFICATIONS,
      DATA_APP.SETTINGS,
    ]);
    const finance = groups[0];
    const transactions = finance.branches.find(
      (branch) => branch.id === 'finance.transactions',
    );
    expect(transactions).toEqual({
      id: 'finance.transactions',
      label: 'Movimientos',
      count: 4,
      includes: [{ id: 'finance.reconciliations', count: 1 }],
    });
  });

  it('counts the settings branch only when there is something to reset', async () => {
    const harness = build();
    harness.findById.mockResolvedValue({
      ...userWithFinance(),
      preferences: { theme: 'dark' },
    });

    const groups = await harness.useCase.listBranches('user-1');

    expect(groups.at(-1)).toEqual({
      app: DATA_APP.SETTINGS,
      branches: [
        {
          id: 'settings.defaults',
          label: 'Configuración por defecto',
          count: 1,
          includes: [],
        },
      ],
    });
    expect(harness.countDataBranches).not.toHaveBeenCalledWith(
      'user-1',
      expect.arrayContaining(['settings.defaults']),
    );
  });
});
