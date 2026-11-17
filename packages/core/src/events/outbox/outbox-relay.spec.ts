import { OutboxRelay } from './outbox-relay';

type OutboxWrite = {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
};

function lastWrite(updateMany: jest.Mock): OutboxWrite {
  return updateMany.mock.calls.at(-1)?.[0] as OutboxWrite;
}

function writes(updateMany: jest.Mock): OutboxWrite[] {
  return updateMany.mock.calls.map((call) => call[0] as OutboxWrite);
}

describe('OutboxRelay', () => {
  const row = {
    id: '1',
    eventId: 'evt-1',
    eventName: 'finance.transaction.confirmed',
    userId: 'user-1',
    aggregateType: 'FinTransaction',
    aggregateId: 'tx-1',
    payload: { amount: 10, eventId: 'forged', userId: 'other' },
    attempts: 0,
    status: 'PENDING',
    claimedAt: null,
  };

  function setup(attempts = 0) {
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce({ ...row, attempts })
      .mockResolvedValue(null);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const emitAsync = jest.fn().mockResolvedValue([]);
    const relay = new OutboxRelay(
      { domainEventOutbox: { findFirst, updateMany } } as never,
      { emitAsync } as never,
    );
    return { relay, findFirst, updateMany, emitAsync };
  }

  it('claims with a lease and acknowledges only its own attempt', async () => {
    const { relay, updateMany, emitAsync } = setup();
    await expect(relay.processBatch()).resolves.toBe(1);
    expect(emitAsync).toHaveBeenCalledWith(
      row.eventName,
      expect.objectContaining({ eventId: 'evt-1', userId: 'user-1' }),
    );
    const acknowledgement = lastWrite(updateMany);
    expect(acknowledgement.where).toMatchObject({
      id: '1',
      status: 'PROCESSING',
      attempts: 1,
    });
    expect(acknowledgement.where.claimedAt).toBeInstanceOf(Date);
    expect(acknowledgement.data).toMatchObject({
      status: 'COMPLETED',
      lastError: null,
      claimedAt: null,
    });
    expect(acknowledgement.data.processedAt).toBeInstanceOf(Date);
  });

  it('retries a rejected delivery with backoff and releases its lease', async () => {
    const { relay, updateMany, emitAsync } = setup();
    emitAsync.mockRejectedValue(new Error('consumer failed'));
    await relay.processBatch();
    const rejection = lastWrite(updateMany);
    expect(rejection.where).toMatchObject({
      status: 'PROCESSING',
      attempts: 1,
    });
    expect(rejection.where.claimedAt).toBeInstanceOf(Date);
    expect(rejection.data).toMatchObject({
      status: 'FAILED',
      claimedAt: null,
      lastError: 'consumer failed',
    });
    expect(rejection.data.nextAttemptAt).toBeInstanceOf(Date);
  });

  it('marks the final failed attempt DEAD', async () => {
    const { relay, updateMany, emitAsync } = setup(7);
    emitAsync.mockRejectedValue(new Error('boom'));
    await relay.processBatch();
    expect(lastWrite(updateMany).data).toMatchObject({ status: 'DEAD' });
  });

  it('recovers abandoned leases and pre-lease deployment rows', async () => {
    const { relay, updateMany } = setup();
    await relay.processBatch();
    const [finalAttempt, retry] = writes(updateMany);
    expect(finalAttempt.where).toMatchObject({
      status: 'PROCESSING',
      attempts: { gte: 8 },
    });
    expect(finalAttempt.data).toMatchObject({ status: 'DEAD' });
    const leaseWindow = finalAttempt.where.OR as {
      claimedAt: { lte: Date } | null;
    }[];
    expect(leaseWindow[0].claimedAt).toHaveProperty('lte');
    expect((leaseWindow[0].claimedAt as { lte: Date }).lte).toBeInstanceOf(
      Date,
    );
    expect(leaseWindow[1]).toEqual({ claimedAt: null });
    expect(retry.where).toMatchObject({ attempts: { lt: 8 } });
    expect(retry.data).toMatchObject({ status: 'PENDING' });
  });

  it('does not dispatch when another worker wins the claim', async () => {
    const { relay, updateMany, emitAsync } = setup();
    updateMany.mockResolvedValue({ count: 0 });
    await expect(relay.processBatch()).resolves.toBe(0);
    expect(emitAsync).not.toHaveBeenCalled();
  });

  it('wakes the same delivery for a producer after its commit', async () => {
    const { relay, emitAsync } = setup();
    await expect(relay.wake()).resolves.toBe(1);
    expect(emitAsync).toHaveBeenCalledTimes(1);
  });
});
