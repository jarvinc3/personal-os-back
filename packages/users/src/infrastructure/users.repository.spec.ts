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
