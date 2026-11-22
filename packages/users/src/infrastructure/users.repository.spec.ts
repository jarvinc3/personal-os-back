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
      attempts: 3,
    });
    expect(authDeletionOutbox.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'oob-1' }),
        data: expect.objectContaining({
          status: 'IN_PROGRESS',
          attempts: { increment: 1 },
        }),
      }),
    );
    const claimPayload = authDeletionOutbox.updateMany.mock.calls[0]?.[0] as {
      data: { claimedAt: Date };
    };
    expect(claimPayload.data.claimedAt).toBeInstanceOf(Date);
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

  it('recovers expired leases before a new claim', async () => {
    authDeletionOutbox.updateMany.mockResolvedValue({ count: 1 });

    await repository.recoverExpiredAuthDeletions(8);

    expect(authDeletionOutbox.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'IN_PROGRESS',
          attempts: { gte: 8 },
          OR: expect.arrayContaining([{ claimedAt: null }]),
        }),
        data: expect.objectContaining({ status: 'DEAD', claimedAt: null }),
      }),
    );
    expect(authDeletionOutbox.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'IN_PROGRESS',
          attempts: { lt: 8 },
          OR: expect.arrayContaining([{ claimedAt: null }]),
        }),
        data: expect.objectContaining({ status: 'FAILED', claimedAt: null }),
      }),
    );
  });

  it('closes the claim only when the attempt still owns the row', async () => {
    authDeletionOutbox.updateMany.mockResolvedValue({ count: 1 });

    await repository.completeAuthDeletion('oob-1', 3);

    expect(authDeletionOutbox.updateMany).toHaveBeenCalledWith({
      where: { id: 'oob-1', status: 'IN_PROGRESS', attempts: 3 },
      data: expect.objectContaining({ status: 'COMPLETED', claimedAt: null }),
    });
  });

  it('fails the claim with its attempt and clears the lease', async () => {
    authDeletionOutbox.updateMany.mockResolvedValue({ count: 1 });
    const nextAttemptAt = new Date('2026-11-21T00:00:00.000Z');

    await repository.failAuthDeletion({
      id: 'oob-1',
      attempts: 3,
      lastError: 'provider down',
      nextAttemptAt,
      terminal: false,
    });

    expect(authDeletionOutbox.updateMany).toHaveBeenCalledWith({
      where: { id: 'oob-1', status: 'IN_PROGRESS', attempts: 3 },
      data: expect.objectContaining({
        status: 'FAILED',
        nextAttemptAt,
        claimedAt: null,
      }),
    });
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
