import { PrismaService } from '@personal-os/database';
import { UsersRepository } from './users.repository';

describe('UsersRepository.claimNextAuthDeletion', () => {
  const authDeletionOutbox = {
    findFirst: jest.fn(),
    updateMany: jest.fn(),
  };

  const prisma = {
    authDeletionOutbox,
  } as unknown as PrismaService;

  const repository = new UsersRepository(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when queue is empty', async () => {
    authDeletionOutbox.findFirst.mockResolvedValue(null);
    await expect(repository.claimNextAuthDeletion(8)).resolves.toBeNull();
    expect(authDeletionOutbox.updateMany).not.toHaveBeenCalled();
  });

  it('claims a due row and returns claim metadata', async () => {
    authDeletionOutbox.findFirst.mockResolvedValue({
      id: 'oob-1',
      userId: 'user-1',
      attempts: 2,
    });
    authDeletionOutbox.updateMany.mockResolvedValue({ count: 1 });

    await expect(repository.claimNextAuthDeletion(8)).resolves.toEqual({
      id: 'oob-1',
      userId: 'user-1',
      attempts: 2,
    });
    expect(authDeletionOutbox.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'oob-1' }),
        data: { status: 'IN_PROGRESS' },
      }),
    );
  });

  it('returns null when another worker already claimed the row', async () => {
    authDeletionOutbox.findFirst.mockResolvedValue({
      id: 'oob-1',
      userId: 'user-1',
      attempts: 0,
    });
    authDeletionOutbox.updateMany.mockResolvedValue({ count: 0 });

    await expect(repository.claimNextAuthDeletion(8)).resolves.toBeNull();
  });
});

describe('UsersRepository settings persistence', () => {
  const userModule = { findMany: jest.fn(), updateMany: jest.fn() };
  const module = { findMany: jest.fn() };
  const user = { update: jest.fn() };
  const tx = { userModule, module, user };
  const prisma = {
    userModule,
    module,
    user,
    $transaction: jest.fn((run: (client: typeof tx) => Promise<unknown>) =>
      run(tx),
    ),
  } as unknown as PrismaService;

  const repository = new UsersRepository(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reads the enabled configs of one module slug', async () => {
    userModule.findMany.mockResolvedValue([
      {
        userId: 'user-1',
        config: { reports: { weeklySummaryDay: 3 } },
        user: { timezone: 'America/Santo_Domingo' },
      },
    ]);

    await expect(
      repository.findEnabledModuleConfigs('finance'),
    ).resolves.toEqual([
      {
        userId: 'user-1',
        timezone: 'America/Santo_Domingo',
        config: { reports: { weeklySummaryDay: 3 } },
      },
    ]);
    expect(userModule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isEnabled: true, module: { slug: 'finance' } },
      }),
    );
  });

  it('resets settings to the defaults each module declares', async () => {
    module.findMany.mockResolvedValue([{ id: 'mod-finance', slug: 'finance' }]);
    userModule.updateMany.mockResolvedValue({ count: 1 });
    user.update.mockResolvedValue({});

    await repository.resetSettingsToDefaults('user-1', [
      { slug: 'finance', defaults: { version: 2 } },
    ]);

    expect(module.findMany).toHaveBeenCalledWith({
      where: { slug: { in: ['finance'] } },
      select: { id: true, slug: true },
    });
    expect(userModule.updateMany).toHaveBeenCalledTimes(1);
    expect(userModule.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', moduleId: 'mod-finance' },
      data: { config: { version: 2 } },
    });
  });
});
