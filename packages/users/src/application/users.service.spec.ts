import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SupabaseAdminService } from '@personal-os/auth';
import { AppEvents } from '@personal-os/core';
import type { UsersRepositoryPort } from './ports/users.repository.port';
import { UsersService } from './users.service';

const REGISTERED_SLUGS = ['finance', 'agenda', 'projects', 'health', 'ai'];

const passThroughSettingsRegistry = {
  has: (slug: string) => REGISTERED_SLUGS.includes(slug),
  normalize: jest.fn(
    (_slug: string, config: Record<string, unknown>) => config,
  ),
  applyPatch: jest.fn(
    (
      _slug: string,
      current: Record<string, unknown>,
      patch: Record<string, unknown>,
    ) => ({ ...current, ...patch }),
  ),
} as never;

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
    passThroughSettingsRegistry,
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
    expect(emitAsync).toHaveBeenCalledWith(AppEvents.USER_ACCOUNT_DELETING, {
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
    passThroughSettingsRegistry,
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
  const emit = jest.fn();
  const eventEmitter = { emit } as unknown as EventEmitter2;
  const supabaseAdminService = {} as unknown as SupabaseAdminService;
  const service = new UsersService(
    usersRepository,
    eventEmitter,
    supabaseAdminService,
    passThroughSettingsRegistry,
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

  it('creates the module disabled when the first save keeps it off', async () => {
    findModuleBySlug.mockResolvedValue({ id: 'mod-agenda' });
    findUserModule.mockResolvedValue(null);

    await service.updateModuleConfig('user-1', 'agenda', {
      config: { defaultView: 'week' },
      isEnabled: false,
    });

    expect(upsertUserModule).toHaveBeenCalledWith({
      userId: 'user-1',
      moduleId: 'mod-agenda',
      config: { defaultView: 'week' },
      isEnabled: false,
    });
    expect(emit).toHaveBeenCalledWith(AppEvents.MODULE_CONFIG_UPDATED, {
      userId: 'user-1',
      slug: 'agenda',
    });
    expect(emit).not.toHaveBeenCalledWith(
      AppEvents.MODULE_ENABLED,
      expect.anything(),
    );
  });

  it('validates AI module settings through the registered descriptor before saving', async () => {
    const registry = {
      has: () => true,
      applyPatch: jest.fn(
        (
          slug: string,
          current: Record<string, unknown>,
          patch: Record<string, unknown>,
        ) => {
          const config = { ...current, ...patch };
          const reviewConfidenceThreshold = (
            config.email as { reviewConfidenceThreshold?: number } | undefined
          )?.reviewConfidenceThreshold;
          if (
            slug === 'ai' &&
            typeof reviewConfidenceThreshold === 'number' &&
            reviewConfidenceThreshold > 1
          ) {
            throw new BadRequestException('invalid confidence threshold');
          }
          return config;
        },
      ),
    };
    const configuredService = new UsersService(
      usersRepository,
      eventEmitter,
      supabaseAdminService,
      registry as never,
    );
    findModuleBySlug.mockResolvedValue({ id: 'mod-ai' });
    findUserModule.mockResolvedValue({
      id: 'um-ai',
      isEnabled: true,
      config: {},
    });

    await expect(
      configuredService.updateModuleConfig('user-1', 'ai', {
        config: { email: { reviewConfidenceThreshold: 1.2 } },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(registry.applyPatch).toHaveBeenCalledWith(
      'ai',
      {},
      {
        email: { reviewConfidenceThreshold: 1.2 },
      },
    );
    expect(upsertUserModule).not.toHaveBeenCalled();
  });

  it('fails fast when the module settings registry is not provided', () => {
    expect(
      () =>
        new UsersService(
          usersRepository,
          eventEmitter,
          supabaseAdminService,
          undefined as never,
        ),
    ).toThrow('MODULE_SETTINGS_REGISTRY');
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
    passThroughSettingsRegistry,
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
    passThroughSettingsRegistry,
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
