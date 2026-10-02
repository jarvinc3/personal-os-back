import type { Queue } from 'bullmq';
import type { GmailSyncJob } from '../../../../core/queues/queue-jobs';
import type { EmailSourceRepository } from '../infrastructure/email-source.repository';
import { EnqueueDueGmailSyncsUseCase } from './enqueue-due-gmail-syncs.use-case';
import { GMAIL_SYNC_JOB_NAME, gmailSyncJobId } from './gmail-sync.constants';

type AutoSyncSource = {
  id: string;
  userId: string;
  lastSyncedAt: Date | null;
  user: {
    timezone: string;
    userModules: Array<{ config: unknown }>;
  };
};

function autoSyncSource(
  overrides: Partial<AutoSyncSource> & { id: string },
): AutoSyncSource {
  return {
    userId: 'user-1',
    lastSyncedAt: null,
    user: {
      timezone: 'UTC',
      userModules: [
        {
          config: {
            emailSync: { schedule: { mode: 'interval', everyMinutes: 360 } },
          },
        },
      ],
    },
    ...overrides,
  };
}

describe('EnqueueDueGmailSyncsUseCase', () => {
  const listAutoSyncSources = jest.fn();
  const repo = {
    listAutoSyncSources,
  } as unknown as EmailSourceRepository;
  const add = jest.fn();
  const queue = { add } as unknown as Queue<GmailSyncJob>;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-22T12:00:00.000Z'));
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns early when the gmail-sync queue is unavailable', async () => {
    const useCase = new EnqueueDueGmailSyncsUseCase(repo);

    await expect(useCase.execute()).resolves.toBeUndefined();
    expect(listAutoSyncSources).not.toHaveBeenCalled();
  });

  it('enqueues a source whose interval elapsed', async () => {
    listAutoSyncSources.mockResolvedValue([
      autoSyncSource({
        id: 'src-1',
        lastSyncedAt: new Date('2026-09-22T05:00:00.000Z'),
      }),
    ]);
    add.mockResolvedValue({});
    const useCase = new EnqueueDueGmailSyncsUseCase(repo, queue);

    await expect(useCase.execute()).resolves.toBeUndefined();

    expect(add).toHaveBeenCalledWith(
      GMAIL_SYNC_JOB_NAME,
      { userId: 'user-1', sourceId: 'src-1', forceFullSync: false },
      expect.objectContaining({ jobId: gmailSyncJobId('src-1') }),
    );
  });

  it('skips a source whose interval has not elapsed', async () => {
    listAutoSyncSources.mockResolvedValue([
      autoSyncSource({
        id: 'src-1',
        lastSyncedAt: new Date('2026-09-22T11:00:00.000Z'),
      }),
    ]);
    const useCase = new EnqueueDueGmailSyncsUseCase(repo, queue);

    await expect(useCase.execute()).resolves.toBeUndefined();
    expect(add).not.toHaveBeenCalled();
  });

  it('honors a custom interval per user', async () => {
    listAutoSyncSources.mockResolvedValue([
      autoSyncSource({
        id: 'src-1',
        lastSyncedAt: new Date('2026-09-22T11:40:00.000Z'),
        user: {
          timezone: 'UTC',
          userModules: [
            {
              config: {
                emailSync: {
                  schedule: { mode: 'interval', everyMinutes: 15 },
                },
              },
            },
          ],
        },
      }),
    ]);
    add.mockResolvedValue({});
    const useCase = new EnqueueDueGmailSyncsUseCase(repo, queue);

    await expect(useCase.execute()).resolves.toBeUndefined();
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('enqueues when a configured time of day passed since the last sync', async () => {
    listAutoSyncSources.mockResolvedValue([
      autoSyncSource({
        id: 'src-1',
        lastSyncedAt: new Date('2026-09-22T07:30:00.000Z'),
        user: {
          timezone: 'UTC',
          userModules: [
            {
              config: {
                emailSync: {
                  schedule: { mode: 'times', times: ['08:00', '18:00'] },
                },
              },
            },
          ],
        },
      }),
    ]);
    add.mockResolvedValue({});
    const useCase = new EnqueueDueGmailSyncsUseCase(repo, queue);

    await expect(useCase.execute()).resolves.toBeUndefined();
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('skips when the last sync is after the latest configured time', async () => {
    listAutoSyncSources.mockResolvedValue([
      autoSyncSource({
        id: 'src-1',
        lastSyncedAt: new Date('2026-09-22T08:05:00.000Z'),
        user: {
          timezone: 'UTC',
          userModules: [
            {
              config: {
                emailSync: {
                  schedule: { mode: 'times', times: ['08:00', '18:00'] },
                },
              },
            },
          ],
        },
      }),
    ]);
    const useCase = new EnqueueDueGmailSyncsUseCase(repo, queue);

    await expect(useCase.execute()).resolves.toBeUndefined();
    expect(add).not.toHaveBeenCalled();
  });

  it('falls back to the default schedule when config is invalid', async () => {
    listAutoSyncSources.mockResolvedValue([
      autoSyncSource({
        id: 'src-1',
        lastSyncedAt: new Date('2026-09-22T05:00:00.000Z'),
        user: {
          timezone: 'UTC',
          userModules: [
            { config: { emailSync: { schedule: { mode: 'bogus' } } } },
          ],
        },
      }),
    ]);
    add.mockResolvedValue({});
    const useCase = new EnqueueDueGmailSyncsUseCase(repo, queue);

    await expect(useCase.execute()).resolves.toBeUndefined();
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('counts duplicate job ids as skipped instead of failing the batch', async () => {
    listAutoSyncSources.mockResolvedValue([
      autoSyncSource({ id: 'src-1', userId: 'user-1' }),
      autoSyncSource({ id: 'src-2', userId: 'user-2' }),
    ]);
    add
      .mockRejectedValueOnce(new Error('Job already exists'))
      .mockResolvedValueOnce({});
    const useCase = new EnqueueDueGmailSyncsUseCase(repo, queue);

    await expect(useCase.execute()).resolves.toBeUndefined();
    expect(add).toHaveBeenCalledTimes(2);
  });
});
