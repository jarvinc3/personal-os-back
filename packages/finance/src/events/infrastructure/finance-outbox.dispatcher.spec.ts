import { FinanceOutboxDispatcher } from './finance-outbox.dispatcher';

describe('FinanceOutboxDispatcher', () => {
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
    const dispatcher = new FinanceOutboxDispatcher(
      { domainEventOutbox: { findFirst, updateMany } } as never,
      { emitAsync } as never,
    );
    return { dispatcher, findFirst, updateMany, emitAsync };
  }

  it('claims with a lease and acknowledges only its own attempt', async () => {
    const { dispatcher, updateMany, emitAsync } = setup();
    await expect(dispatcher.processBatch()).resolves.toBe(1);
    expect(emitAsync).toHaveBeenCalledWith(
      row.eventName,
      expect.objectContaining({ eventId: 'evt-1', userId: 'user-1' }),
    );
    expect(updateMany).toHaveBeenLastCalledWith({
      where: {
        id: '1',
        status: 'PROCESSING',
        attempts: 1,
        claimedAt: expect.any(Date),
      },
      data: {
        status: 'COMPLETED',
        processedAt: expect.any(Date),
        lastError: null,
        claimedAt: null,
      },
    });
  });

  it('retries a rejected delivery with backoff and releases its lease', async () => {
    const { dispatcher, updateMany, emitAsync } = setup();
    emitAsync.mockRejectedValue(new Error('consumer failed'));
    await dispatcher.processBatch();
    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ attempts: 1, status: 'PROCESSING' }),
        data: expect.objectContaining({
          status: 'FAILED',
          claimedAt: null,
          lastError: 'consumer failed',
          nextAttemptAt: expect.any(Date),
        }),
      }),
    );
  });

  it('marks the final failed attempt DEAD', async () => {
    const { dispatcher, updateMany, emitAsync } = setup(7);
    emitAsync.mockRejectedValue(new Error('boom'));
    await dispatcher.processBatch();
    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'DEAD' }),
      }),
    );
  });

  it('recovers abandoned leases and pre-lease deployment rows', async () => {
    const { dispatcher, updateMany } = setup();
    await dispatcher.processBatch();
    expect(updateMany.mock.calls[0][0]).toMatchObject({
      where: {
        status: 'PROCESSING',
        attempts: { gte: 8 },
        OR: [{ claimedAt: { lte: expect.any(Date) } }, { claimedAt: null }],
      },
      data: { status: 'DEAD' },
    });
    expect(updateMany.mock.calls[1][0]).toMatchObject({
      where: { attempts: { lt: 8 } },
      data: { status: 'PENDING' },
    });
  });

  it('does not dispatch when another worker wins the claim', async () => {
    const { dispatcher, updateMany, emitAsync } = setup();
    updateMany.mockResolvedValue({ count: 0 });
    await expect(dispatcher.processBatch()).resolves.toBe(0);
    expect(emitAsync).not.toHaveBeenCalled();
  });
});
