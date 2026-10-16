import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SupabaseAdminService } from '@personal-os/auth';
import type { UsersRepositoryPort } from './ports/users.repository.port';
import { UsersService } from './users.service';

describe('UsersService.deleteAccount', () => {
  const findById = jest.fn();
  const deleteAccountWithAuthOutbox = jest.fn();
  const markAuthOutboxCompleted = jest.fn();
  const tryDeleteAuthUser = jest.fn();

  const usersRepository = {
    findById,
    deleteAccountWithAuthOutbox,
    markAuthOutboxCompleted,
  } as unknown as UsersRepositoryPort;

  const supabaseAdminService = {
    tryDeleteAuthUser,
  } as unknown as SupabaseAdminService;

  const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;

  const service = new UsersService(
    usersRepository,
    eventEmitter,
    supabaseAdminService,
  );

  const existingUser = {
    id: 'user-1',
    email: 'u@example.com',
    fullName: 'User',
    avatarUrl: null,
    timezone: 'UTC',
    locale: 'en',
    preferences: {},
    userModules: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    findById.mockResolvedValue(existingUser);
    deleteAccountWithAuthOutbox.mockResolvedValue(undefined);
    markAuthOutboxCompleted.mockResolvedValue(undefined);
  });

  it('throws when user is missing', async () => {
    findById.mockResolvedValue(null);
    await expect(service.deleteAccount('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(deleteAccountWithAuthOutbox).not.toHaveBeenCalled();
  });

  it('returns authCleanupPending false when auth delete succeeds', async () => {
    tryDeleteAuthUser.mockResolvedValue({ ok: true });

    const result = await service.deleteAccount('user-1');

    expect(deleteAccountWithAuthOutbox).toHaveBeenCalledWith('user-1');
    expect(markAuthOutboxCompleted).toHaveBeenCalledWith('user-1');
    expect(result).toEqual({ success: true, authCleanupPending: false });
  });

  it('returns authCleanupPending true when auth delete fails after postgres wipe', async () => {
    tryDeleteAuthUser.mockResolvedValue({
      ok: false,
      message: 'temporary outage',
      retryable: true,
    });

    const result = await service.deleteAccount('user-1');

    expect(deleteAccountWithAuthOutbox).toHaveBeenCalled();
    expect(markAuthOutboxCompleted).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, authCleanupPending: true });
  });

  it('does not call auth when postgres outbox transaction fails', async () => {
    deleteAccountWithAuthOutbox.mockRejectedValue(new Error('db down'));

    await expect(service.deleteAccount('user-1')).rejects.toThrow('db down');
    expect(tryDeleteAuthUser).not.toHaveBeenCalled();
  });
});

describe('UsersService.assertModuleEnabled', () => {
  const findEnabledUserModuleBySlug = jest.fn();
  const usersRepository = {
    findEnabledUserModuleBySlug,
  } as unknown as UsersRepositoryPort;

  const service = new UsersService(
    usersRepository,
    { emit: jest.fn() } as unknown as EventEmitter2,
    { tryDeleteAuthUser: jest.fn() } as unknown as SupabaseAdminService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves when an enabled row exists', async () => {
    findEnabledUserModuleBySlug.mockResolvedValue({ id: 'um-1' });
    await expect(
      service.assertModuleEnabled('user-1', 'finance'),
    ).resolves.toBeUndefined();
  });

  it('throws ForbiddenException when the row is missing', async () => {
    findEnabledUserModuleBySlug.mockResolvedValue(null);
    await expect(
      service.assertModuleEnabled('user-1', 'finance'),
    ).rejects.toThrow('El módulo finance está desactivado');
  });
});

describe('UsersService.assertFinanceEmailSyncEnabled', () => {
  const findEnabledUserModuleBySlug = jest.fn();
  const findUserModuleBySlug = jest.fn();
  const usersRepository = {
    findEnabledUserModuleBySlug,
    findUserModuleBySlug,
  } as unknown as UsersRepositoryPort;

  const service = new UsersService(
    usersRepository,
    { emit: jest.fn() } as unknown as EventEmitter2,
    { tryDeleteAuthUser: jest.fn() } as unknown as SupabaseAdminService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    findEnabledUserModuleBySlug.mockResolvedValue({ id: 'um-1' });
  });

  it('resolves when emailSync.enabled is true', async () => {
    findUserModuleBySlug.mockResolvedValue({
      id: 'um-1',
      isEnabled: true,
      config: { emailSync: { enabled: true } },
    });
    await expect(
      service.assertFinanceEmailSyncEnabled('user-1'),
    ).resolves.toBeUndefined();
  });

  it('throws when emailSync is disabled', async () => {
    findUserModuleBySlug.mockResolvedValue({
      id: 'um-1',
      isEnabled: true,
      config: { emailSync: { enabled: false } },
    });
    await expect(
      service.assertFinanceEmailSyncEnabled('user-1'),
    ).rejects.toThrow(
      'La sincronización de correo de finanzas está desactivada',
    );
  });

  it('throws when emailSync is omitted (default is disabled)', async () => {
    findUserModuleBySlug.mockResolvedValue({
      id: 'um-1',
      isEnabled: true,
      config: {},
    });
    await expect(
      service.assertFinanceEmailSyncEnabled('user-1'),
    ).rejects.toThrow(
      'La sincronización de correo de finanzas está desactivada',
    );
  });
});

describe('UsersService.isFinanceEmailSyncAutomatic', () => {
  const findUserModuleBySlug = jest.fn();
  const usersRepository = {
    findUserModuleBySlug,
  } as unknown as UsersRepositoryPort;

  const service = new UsersService(
    usersRepository,
    { emit: jest.fn() } as unknown as EventEmitter2,
    { tryDeleteAuthUser: jest.fn() } as unknown as SupabaseAdminService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns true only when both enabled and automatic are true', async () => {
    findUserModuleBySlug.mockResolvedValue({
      config: { emailSync: { enabled: true, automatic: true } },
    });
    await expect(service.isFinanceEmailSyncAutomatic('user-1')).resolves.toBe(
      true,
    );
  });

  it('returns false when automatic is omitted (default off)', async () => {
    findUserModuleBySlug.mockResolvedValue({
      config: { emailSync: { enabled: true } },
    });
    await expect(service.isFinanceEmailSyncAutomatic('user-1')).resolves.toBe(
      false,
    );
  });

  it('returns false when sync is enabled but automatic is off', async () => {
    findUserModuleBySlug.mockResolvedValue({
      config: { emailSync: { enabled: true, automatic: false } },
    });
    await expect(service.isFinanceEmailSyncAutomatic('user-1')).resolves.toBe(
      false,
    );
  });
});

describe('UsersService.updateModuleConfig schedule validation', () => {
  const findModuleBySlug = jest.fn();
  const findUserModule = jest.fn();
  const upsertUserModule = jest.fn();
  const findById = jest.fn();

  const usersRepository = {
    findModuleBySlug,
    findUserModule,
    upsertUserModule,
    findById,
  } as unknown as UsersRepositoryPort;
  const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;
  const supabaseAdminService = {} as unknown as SupabaseAdminService;
  const service = new UsersService(
    usersRepository,
    eventEmitter,
    supabaseAdminService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    findModuleBySlug.mockResolvedValue({ id: 'mod-finance' });
    findUserModule.mockResolvedValue({
      id: 'um-1',
      isEnabled: true,
      config: {},
    });
    upsertUserModule.mockResolvedValue(undefined);
    findById.mockResolvedValue({
      id: 'user-1',
      email: 'u@example.com',
      fullName: 'User',
      avatarUrl: null,
      timezone: 'UTC',
      locale: 'en',
      preferences: {},
      userModules: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it('rejects an interval below the minimum', async () => {
    await expect(
      service.updateModuleConfig('user-1', 'finance', {
        config: {
          emailSync: { schedule: { mode: 'interval', everyMinutes: 5 } },
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(upsertUserModule).not.toHaveBeenCalled();
  });

  it('accepts fixed times in HH:MM', async () => {
    await service.updateModuleConfig('user-1', 'finance', {
      config: {
        emailSync: { schedule: { mode: 'times', times: ['08:00', '18:00'] } },
      },
    });
    expect(upsertUserModule).toHaveBeenCalled();
  });

  it('rejects the retired subscriptions slug', async () => {
    await expect(
      service.updateModuleConfig('user-1', 'subscriptions', {
        config: {},
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(upsertUserModule).not.toHaveBeenCalled();
  });
});

describe('UsersService.listWeeklySummaryRecipients', () => {
  const findFinanceSummaryRecipients = jest.fn();
  const usersRepository = {
    findFinanceSummaryRecipients,
  } as unknown as UsersRepositoryPort;
  const service = new UsersService(
    usersRepository,
    { emit: jest.fn() } as unknown as EventEmitter2,
    {} as unknown as SupabaseAdminService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('defaults to Monday when the report day is not configured', async () => {
    findFinanceSummaryRecipients.mockResolvedValue([
      { userId: 'user-1', timezone: 'America/Santo_Domingo', config: {} },
    ]);

    await expect(service.listWeeklySummaryRecipients()).resolves.toEqual([
      { userId: 'user-1', timezone: 'America/Santo_Domingo', day: 1 },
    ]);
  });

  it('skips users who turned the weekly summary off', async () => {
    findFinanceSummaryRecipients.mockResolvedValue([
      {
        userId: 'user-1',
        timezone: 'UTC',
        config: { notifications: { weeklySummary: false } },
      },
    ]);

    await expect(service.listWeeklySummaryRecipients()).resolves.toEqual([]);
  });

  it('uses the configured report day', async () => {
    findFinanceSummaryRecipients.mockResolvedValue([
      {
        userId: 'user-1',
        timezone: 'UTC',
        config: { reports: { weeklySummaryDay: 5 } },
      },
    ]);

    await expect(service.listWeeklySummaryRecipients()).resolves.toEqual([
      { userId: 'user-1', timezone: 'UTC', day: 5 },
    ]);
  });
});

describe('UsersService.markReleaseNotesSeen', () => {
  const findById = jest.fn();
  const setLastSeenReleaseVersion = jest.fn();
  const usersRepository = {
    findById,
    setLastSeenReleaseVersion,
  } as unknown as UsersRepositoryPort;

  const service = new UsersService(
    usersRepository,
    { emit: jest.fn() } as unknown as EventEmitter2,
    { tryDeleteAuthUser: jest.fn() } as unknown as SupabaseAdminService,
  );

  const profileRow = {
    id: 'user-1',
    email: 'u@example.com',
    fullName: 'User',
    avatarUrl: null,
    timezone: 'UTC',
    locale: 'en',
    preferences: {},
    lastSeenReleaseVersion: null,
    userModules: [],
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    findById.mockResolvedValue(profileRow);
  });

  it('throws when the user does not exist', async () => {
    findById.mockResolvedValue(null);

    await expect(
      service.markReleaseNotesSeen('missing', '0.39.0'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(setLastSeenReleaseVersion).not.toHaveBeenCalled();
  });

  it('persists the version for the given user', async () => {
    setLastSeenReleaseVersion.mockResolvedValue(undefined);

    await expect(
      service.markReleaseNotesSeen('user-1', '0.39.0'),
    ).resolves.toBeUndefined();

    expect(setLastSeenReleaseVersion).toHaveBeenCalledWith('user-1', '0.39.0');
  });
});
