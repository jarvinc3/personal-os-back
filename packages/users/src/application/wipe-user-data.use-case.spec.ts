import { NotFoundException } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { AppEvents } from '@personal-os/core';
import { WIPE_LAYERS } from '../domain/wipe-layers';
import type { UserDataWipeDomainsPort } from './ports/user-data-wipe-domains.port';
import type { UsersRepositoryPort } from './ports/users.repository.port';
import { WipeUserDataUseCase } from './wipe-user-data.use-case';

function build() {
  const findById = jest.fn();
  const pauseFinanceEmailSyncAutomatic = jest.fn();
  const resetSettingsToDefaults = jest.fn();
  const usersRepository = {
    findById,
    pauseFinanceEmailSyncAutomatic,
    resetSettingsToDefaults,
  } as unknown as UsersRepositoryPort;

  const wipeFinance = jest.fn();
  const wipeAi = jest.fn();
  const wipeNotifications = jest.fn();
  const domains = {
    wipeFinance,
    wipeAi,
    wipeNotifications,
  } as unknown as UserDataWipeDomainsPort;

  const emit = jest.fn();
  const eventEmitter = { emit } as unknown as EventEmitter2;
  const useCase = new WipeUserDataUseCase(
    usersRepository,
    domains,
    eventEmitter,
  );

  return {
    useCase,
    findById,
    pauseFinanceEmailSyncAutomatic,
    resetSettingsToDefaults,
    wipeFinance,
    wipeAi,
    wipeNotifications,
    emit,
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
      harness.useCase.execute('missing', [WIPE_LAYERS.AI_SESSIONS]),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(harness.wipeAi).not.toHaveBeenCalled();
  });

  it('expands the catalog with the ledger and pauses automatic email sync', async () => {
    const harness = build();
    harness.findById.mockResolvedValue({ id: 'user-1' });
    harness.wipeFinance.mockResolvedValue({ transactions: 4 });

    const wipeResult = await harness.useCase.execute('user-1', [
      WIPE_LAYERS.FINANCE_CATALOG,
    ]);

    expect(harness.wipeFinance).toHaveBeenCalledWith('user-1', [
      WIPE_LAYERS.FINANCE_LEDGER,
      WIPE_LAYERS.FINANCE_CATALOG,
    ]);
    expect(harness.pauseFinanceEmailSyncAutomatic).toHaveBeenCalledWith(
      'user-1',
    );
    expect(wipeResult.appliedLayers).toEqual([
      WIPE_LAYERS.FINANCE_LEDGER,
      WIPE_LAYERS.FINANCE_CATALOG,
    ]);
    expect(wipeResult.requestedLayers).toEqual([WIPE_LAYERS.FINANCE_CATALOG]);
  });

  it('forwards the institution scope only when balances are selected', async () => {
    const harness = build();
    harness.findById.mockResolvedValue({ id: 'user-1' });
    harness.wipeFinance.mockResolvedValue({ accountBalances: 1 });

    await harness.useCase.execute(
      'user-1',
      [WIPE_LAYERS.FINANCE_BALANCES],
      { balanceInstitutionId: 'inst-1' },
    );

    expect(harness.wipeFinance).toHaveBeenCalledWith(
      'user-1',
      [WIPE_LAYERS.FINANCE_BALANCES],
      { balanceInstitutionId: 'inst-1' },
    );

    harness.wipeFinance.mockClear();
    await harness.useCase.execute(
      'user-1',
      [WIPE_LAYERS.FINANCE_LEDGER],
      { balanceInstitutionId: 'inst-1' },
    );
    expect(harness.wipeFinance).toHaveBeenCalledWith('user-1', [
      WIPE_LAYERS.FINANCE_LEDGER,
    ]);
  });

  it('does not touch finance when only AI sessions are requested', async () => {
    const harness = build();
    harness.findById.mockResolvedValue({ id: 'user-1' });
    harness.wipeAi.mockResolvedValue({ sessions: 3 });

    const wipeResult = await harness.useCase.execute('user-1', [
      WIPE_LAYERS.AI_SESSIONS,
    ]);

    expect(harness.wipeFinance).not.toHaveBeenCalled();
    expect(harness.pauseFinanceEmailSyncAutomatic).not.toHaveBeenCalled();
    expect(wipeResult.counts).toEqual({ sessions: 3 });
  });

  it('resets settings only when asked', async () => {
    const harness = build();
    harness.findById.mockResolvedValue({ id: 'user-1' });

    await harness.useCase.execute('user-1', [WIPE_LAYERS.NOTIFICATIONS]);

    expect(harness.resetSettingsToDefaults).not.toHaveBeenCalled();
  });

  it('resets settings and wipes notifications when asked', async () => {
    const harness = build();
    harness.findById.mockResolvedValue({ id: 'user-1' });
    harness.wipeNotifications.mockResolvedValue({
      notifications: 2,
      pushTokens: 1,
    });
    harness.resetSettingsToDefaults.mockResolvedValue(undefined);

    const wipeResult = await harness.useCase.execute('user-1', [
      WIPE_LAYERS.NOTIFICATIONS,
      WIPE_LAYERS.SETTINGS_DEFAULTS,
    ]);

    expect(harness.resetSettingsToDefaults).toHaveBeenCalledWith('user-1');
    expect(wipeResult.counts).toEqual({ notifications: 2, pushTokens: 1 });
  });

  it('emits a single aggregated event', async () => {
    const harness = build();
    harness.findById.mockResolvedValue({ id: 'user-1' });
    harness.wipeAi.mockResolvedValue({ sessions: 1 });

    await harness.useCase.execute('user-1', [WIPE_LAYERS.AI_SESSIONS]);

    expect(harness.emit).toHaveBeenCalledTimes(1);
    expect(harness.emit).toHaveBeenCalledWith(
      AppEvents.USER_DATA_WIPED,
      expect.objectContaining({
        userId: 'user-1',
        appliedLayers: [WIPE_LAYERS.AI_SESSIONS],
        counts: { sessions: 1 },
      }),
    );
  });
});
