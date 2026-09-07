import { NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SupabaseAdminService } from '../../auth';
import { UsersRepository } from '../infrastructure/users.repository';
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
  } as unknown as UsersRepository;

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
  } as unknown as UsersRepository;

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
    ).rejects.toThrow('Finance module is disabled');
  });
});

describe('UsersService.assertFinanceEmailSyncEnabled', () => {
  const findEnabledUserModuleBySlug = jest.fn();
  const findUserModuleBySlug = jest.fn();
  const usersRepository = {
    findEnabledUserModuleBySlug,
    findUserModuleBySlug,
  } as unknown as UsersRepository;

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
    ).rejects.toThrow('Finance email sync is disabled');
  });

  it('throws when emailSync is omitted (default is disabled)', async () => {
    findUserModuleBySlug.mockResolvedValue({
      id: 'um-1',
      isEnabled: true,
      config: {},
    });
    await expect(
      service.assertFinanceEmailSyncEnabled('user-1'),
    ).rejects.toThrow('Finance email sync is disabled');
  });
});
