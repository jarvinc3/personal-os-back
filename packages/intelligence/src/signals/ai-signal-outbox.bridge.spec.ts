import type { Queue } from 'bullmq';
import { AiSignalOutboxBridge } from './ai-signal-outbox.bridge';

describe('AiSignalOutboxBridge', () => {
  it('uses the outbox event id as a stable BullMQ job id', async () => {
    const queue = { add: jest.fn().mockResolvedValue({}) };
    const bridge = new AiSignalOutboxBridge(queue as unknown as Queue);
    await bridge.enqueue({
      eventId: 'ai.signal.routed:email-123',
      signalId: 'email-123',
      userId: 'user-1',
    });
    expect(queue.add).toHaveBeenCalledWith(
      'route-signal',
      { signalId: 'email-123', userId: 'user-1' },
      {
        jobId: 'ai.signal.routed_email-123',
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
      },
    );
  });

  it('propagates enqueue failures so the outbox relay retries', async () => {
    const queue = { add: jest.fn().mockRejectedValue(new Error('redis down')) };
    const bridge = new AiSignalOutboxBridge(queue as unknown as Queue);
    await expect(
      bridge.enqueue({
        eventId: 'event-1',
        signalId: 'signal-1',
        userId: 'user-1',
      }),
    ).rejects.toThrow('redis down');
  });

  it('keeps the outbox retryable when BullMQ is disabled', async () => {
    const bridge = new AiSignalOutboxBridge(undefined);
    await expect(
      bridge.enqueue({
        eventId: 'event-1',
        signalId: 'signal-1',
        userId: 'user-1',
      }),
    ).rejects.toThrow('AI signal routing queue is not configured');
  });
});
