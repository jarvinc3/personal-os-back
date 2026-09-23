import type { Queue } from 'bullmq';
import type { GmailSyncJob } from '../../../../core/queues/queue-jobs';
import type { EmailSourceRepository } from '../infrastructure/email-source.repository';
import { EnqueueDueGmailSyncsUseCase } from './enqueue-due-gmail-syncs.use-case';
import {
  GMAIL_AUTO_SYNC_INTERVAL_MS,
  GMAIL_SYNC_JOB_NAME,
  gmailSyncJobId,
} from './gmail-sync.constants';

describe('EnqueueDueGmailSyncsUseCase', () => {
  const listDueGmailSyncSources = jest.fn();
  const repo = {
    listDueGmailSyncSources,
  } as unknown as EmailSourceRepository;
  const add = jest.fn();
  const queue = { add } as unknown as Queue<GmailSyncJob>;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-22T18:00:00.000Z'));
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns zeros when the gmail-sync queue is unavailable', async () => {
    const useCase = new EnqueueDueGmailSyncsUseCase(repo);

    await expect(useCase.execute()).resolves.toEqual({ queued: 0, skipped: 0 });
    expect(listDueGmailSyncSources).not.toHaveBeenCalled();
  });

  it('enqueues due sources with a stable job id and no forceFullSync', async () => {
    listDueGmailSyncSources.mockResolvedValue([
      { id: 'src-1', userId: 'user-1' },
      { id: 'src-2', userId: 'user-2' },
    ]);
    add.mockResolvedValue({});
    const useCase = new EnqueueDueGmailSyncsUseCase(repo, queue);

    await expect(useCase.execute()).resolves.toEqual({ queued: 2, skipped: 0 });

    const cutoff = new Date(
      Date.now() - GMAIL_AUTO_SYNC_INTERVAL_MS,
    );
    expect(listDueGmailSyncSources).toHaveBeenCalledWith(cutoff);
    expect(add).toHaveBeenNthCalledWith(
      1,
      GMAIL_SYNC_JOB_NAME,
      { userId: 'user-1', sourceId: 'src-1', forceFullSync: false },
      expect.objectContaining({ jobId: gmailSyncJobId('src-1') }),
    );
    expect(add).toHaveBeenNthCalledWith(
      2,
      GMAIL_SYNC_JOB_NAME,
      { userId: 'user-2', sourceId: 'src-2', forceFullSync: false },
      expect.objectContaining({ jobId: gmailSyncJobId('src-2') }),
    );
  });

  it('counts duplicate job ids as skipped instead of failing the batch', async () => {
    listDueGmailSyncSources.mockResolvedValue([
      { id: 'src-1', userId: 'user-1' },
      { id: 'src-2', userId: 'user-2' },
    ]);
    add
      .mockRejectedValueOnce(new Error('Job already exists'))
      .mockResolvedValueOnce({});
    const useCase = new EnqueueDueGmailSyncsUseCase(repo, queue);

    await expect(useCase.execute()).resolves.toEqual({ queued: 1, skipped: 1 });
  });
});
