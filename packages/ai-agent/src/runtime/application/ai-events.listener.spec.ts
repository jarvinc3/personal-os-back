import type { Queue } from 'bullmq';
import type { DomainEventIdempotencyGuard } from '@personal-os/core';
import type { AiProcessingJob } from '@personal-os/core';
import { AiEventsListener } from './ai-events.listener';

describe('AiEventsListener.onEmailSyncCompleted', () => {
  const add = jest.fn();
  const tryClaim = jest.fn().mockResolvedValue(true);

  const queue = { add } as unknown as Queue<AiProcessingJob>;
  const idempotency = { tryClaim } as unknown as DomainEventIdempotencyGuard;

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

  it('skips enqueue when idempotency claim fails', async () => {
    tryClaim.mockResolvedValue(false);

    await listener.onEmailSyncCompleted(baseEvent);

    expect(tryClaim).toHaveBeenCalledWith('evt-1', 'ai-agent:email-sync');
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
        jobId: expect.stringContaining('ai-email-sync-'),
      }),
    );
  });
});
