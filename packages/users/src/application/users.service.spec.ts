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

  const emitAsync = jest.fn().mockResolvedValue([]);
  const eventEmitter = {
    emit: jest.fn(),
    emitAsync,
  } as unknown as EventEmitter2;

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
    expect(emitAsync).toHaveBeenCalledWith('users.account.deleting', {
      userId: 'user-1',
    });
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

  it('no borra la cuenta si falla la anonimización AI', async () => {
    emitAsync.mockRejectedValueOnce(new Error('ai wipe failed'));
    await expect(service.deleteAccount('user-1')).rejects.toThrow(
      'ai wipe failed',
    );
    expect(deleteAccountWithAuthOutbox).not.toHaveBeenCalled();
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
    ).rejects.toThrow('La app Finanzas está desactivada');
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

describe('UsersService.updateProfile', () => {
  const findById = jest.fn();
  const updateProfile = jest.fn();
  const usersRepository = {
    findById,
    updateProfile,
  } as unknown as UsersRepositoryPort;
  const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;
  const supabaseAdminService = {
    tryDeleteAuthUser: jest.fn(),
  } as unknown as SupabaseAdminService;

  const service = new UsersService(
    usersRepository,
    eventEmitter,
    supabaseAdminService,
  );

  const profileRow = {
    id: 'user-1',
    email: 'u@example.com',
    fullName: 'User',
    avatarUrl: null,
    timezone: 'America/Santo_Domingo',
    locale: 'es-DO',
    preferences: {},
    lastSeenReleaseVersion: null,
    userModules: [],
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    findById.mockResolvedValue(profileRow);
    updateProfile.mockImplementation(
      (_userId: string, data: Record<string, unknown>) =>
        Promise.resolve({ ...profileRow, ...data }),
    );
  });

  it('rejects a week start outside the supported values', async () => {
    await expect(
      service.updateProfile('user-1', {
        preferences: { regional: { weekStartsOn: 3 } },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('persists the regional week start', async () => {
    await service.updateProfile('user-1', {
      preferences: { regional: { weekStartsOn: 0 } },
    });

    expect(updateProfile).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        preferences: expect.objectContaining({
          regional: { weekStartsOn: 0 },
        }),
      }),
    );
  });
});
