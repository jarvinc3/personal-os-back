import { SupabaseAdminService } from '@personal-os/auth';
import { AuthDeletionOutboxProcessor } from './auth-deletion-outbox.processor';
import type { UsersRepositoryPort } from './ports/users.repository.port';

describe('AuthDeletionOutboxProcessor', () => {
  const claimNextAuthDeletion = jest.fn();
  const recoverExpiredAuthDeletions = jest.fn();
  const completeAuthDeletion = jest.fn();
  const failAuthDeletion = jest.fn();
  const tryDeleteAuthUser = jest.fn();

  const usersRepository = {
    claimNextAuthDeletion,
    recoverExpiredAuthDeletions,
    completeAuthDeletion,
    failAuthDeletion,
  } as unknown as UsersRepositoryPort;

  const supabaseAdminService = {
    tryDeleteAuthUser,
  } as unknown as SupabaseAdminService;

  const processor = new AuthDeletionOutboxProcessor(
    usersRepository,
    supabaseAdminService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    completeAuthDeletion.mockResolvedValue({ count: 1 });
    failAuthDeletion.mockResolvedValue({ count: 1 });
  });

  it('no-ops when queue empty', async () => {
    claimNextAuthDeletion.mockResolvedValue(null);
    const n = await processor.processBatch();
    expect(n).toBe(0);
    expect(recoverExpiredAuthDeletions).toHaveBeenCalledTimes(1);
    expect(tryDeleteAuthUser).not.toHaveBeenCalled();
  });

  it('completes successful auth deletion', async () => {
    claimNextAuthDeletion
      .mockResolvedValueOnce({
        id: 'oob-1',
        userId: 'user-1',
        attempts: 1,
      })
      .mockResolvedValueOnce(null);
    tryDeleteAuthUser.mockResolvedValue({ ok: true });

    const n = await processor.processBatch();
    expect(n).toBe(1);
    expect(completeAuthDeletion).toHaveBeenCalledWith('oob-1', 1);
  });

  it('schedules retry on retryable failure', async () => {
    claimNextAuthDeletion
      .mockResolvedValueOnce({
        id: 'oob-2',
        userId: 'user-2',
        attempts: 1,
      })
      .mockResolvedValueOnce(null);
    tryDeleteAuthUser.mockResolvedValue({
      ok: false,
      message: 'rate limited',
      retryable: true,
    });

    await processor.processBatch();

    expect(failAuthDeletion).toHaveBeenCalledWith(
      'oob-2',
      1,
      'rate limited',
      expect.any(Date),
      false,
    );
  });

  it('marks DEAD on non-retryable failure', async () => {
    claimNextAuthDeletion
      .mockResolvedValueOnce({
        id: 'oob-4',
        userId: 'user-4',
        attempts: 1,
      })
      .mockResolvedValueOnce(null);
    tryDeleteAuthUser.mockResolvedValue({
      ok: false,
      message: 'forbidden',
      retryable: false,
    });

    await processor.processBatch();

    expect(failAuthDeletion).toHaveBeenCalledWith(
      'oob-4',
      1,
      'forbidden',
      expect.any(Date),
      true,
    );
  });

  it('marks DEAD after max attempts', async () => {
    claimNextAuthDeletion
      .mockResolvedValueOnce({
        id: 'oob-3',
        userId: 'user-3',
        attempts: 8,
      })
      .mockResolvedValueOnce(null);
    tryDeleteAuthUser.mockResolvedValue({
      ok: false,
      message: 'still failing',
      retryable: true,
    });

    await processor.processBatch();

    expect(failAuthDeletion).toHaveBeenCalledWith(
      'oob-3',
      8,
      'still failing',
      expect.any(Date),
      true,
    );
  });

  it('no cierra la fila si perdió el lease', async () => {
    claimNextAuthDeletion
      .mockResolvedValueOnce({
        id: 'oob-5',
        userId: 'user-5',
        attempts: 1,
      })
      .mockResolvedValueOnce(null);
    tryDeleteAuthUser.mockResolvedValue({ ok: true });
    completeAuthDeletion.mockResolvedValue({ count: 0 });

    await expect(processor.processBatch()).resolves.toBe(1);
    expect(completeAuthDeletion).toHaveBeenCalledWith('oob-5', 1);
  });
});
