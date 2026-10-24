import type { Queue } from 'bullmq';
import type { DomainEventIdempotencyGuard } from '@personal-os/core';
import type { AiProcessingJob } from '@personal-os/core';
import { AiEventsListener } from './ai-events.listener';

describe('AiEventsListener.onEmailSyncCompleted', () => {
  const add = jest.fn();
  const tryClaim = jest.fn().mockResolvedValue(true);
  const wasProcessed = jest.fn().mockResolvedValue(false);

  const queue = { add } as unknown as Queue<AiProcessingJob>;
  const idempotency = {
    tryClaim,
    wasProcessed,
  } as unknown as DomainEventIdempotencyGuard;

  const listener = new AiEventsListener(queue, idempotency);

  const baseEvent = {
    eventId: 'evt-1',
    userId: 'user-1',
    sourceId: 'src-1',
    emailsScanned: 3,
    transactionsNew: 2,
    transactionIds: ['tx-1', 'tx-2'],
    countsByStatus: { PENDING: 2 },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tryClaim.mockResolvedValue(true);
    wasProcessed.mockResolvedValue(false);
    add.mockResolvedValue({ id: 'job' });
  });

  it('returns without claiming when transactionsNew is zero', async () => {
    await listener.onEmailSyncCompleted({
      ...baseEvent,
      transactionsNew: 0,
      transactionIds: [],
    });

    expect(tryClaim).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('skips enqueue when the event was already processed', async () => {
    wasProcessed.mockResolvedValue(true);

    await listener.onEmailSyncCompleted(baseEvent);

    expect(wasProcessed).toHaveBeenCalledWith('evt-1', 'ai-agent:email-sync');
    expect(tryClaim).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('enqueues ai insight job when claim succeeds and there are new transactions', async () => {
    await listener.onEmailSyncCompleted(baseEvent);

    expect(tryClaim).toHaveBeenCalledWith('evt-1', 'ai-agent:email-sync');
    expect(add).toHaveBeenCalledWith(
      'ai-insight-email-sync',
      {
        userId: 'user-1',
        actionType: 'finance.email_sync.completed',
        payload: expect.objectContaining({
          slug: 'finance',
          sourceId: 'src-1',
          emailsScanned: 3,
          transactionsNew: 2,
          transactionIds: ['tx-1', 'tx-2'],
          countsByStatus: { PENDING: 2 },
        }),
      },
      expect.objectContaining({
        jobId: expect.stringContaining('ai-event-'),
        removeOnComplete: false,
        removeOnFail: false,
      }),
    );
  });
  it('does not mark an event when Redis enqueue fails', async () => {
    add.mockRejectedValueOnce(new Error('Redis unavailable'));
    await expect(listener.onEmailSyncCompleted(baseEvent)).rejects.toThrow(
      'Redis unavailable',
    );
    expect(tryClaim).not.toHaveBeenCalled();
  });

  it('reuses the job ID when receipt commit fails after enqueue', async () => {
    tryClaim.mockRejectedValueOnce(new Error('commit failed'));
    await expect(listener.onEmailSyncCompleted(baseEvent)).rejects.toThrow(
      'commit failed',
    );
    await listener.onEmailSyncCompleted(baseEvent);
    expect(add.mock.calls[0][2].jobId).toBe(add.mock.calls[1][2].jobId);
  });

  it('rejects durable events when the queue is unavailable', async () => {
    const offline = new AiEventsListener(undefined, idempotency);
    await expect(offline.onEmailSyncCompleted(baseEvent)).rejects.toThrow(
      'requires its queue',
    );
    expect(tryClaim).not.toHaveBeenCalled();
  });
});
