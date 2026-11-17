import { DomainEventIdempotencyGuard } from './domain-event-idempotency.guard';

describe('DomainEventIdempotencyGuard', () => {
  const createMany = jest.fn();
  const findUnique = jest.fn();
  const findFirst = jest.fn();
  const tx = { processedDomainEvent: { createMany } };
  const transaction = jest.fn(
    (effect: (client: typeof tx) => Promise<unknown>) => effect(tx),
  );
  const guard = new DomainEventIdempotencyGuard({
    $transaction: transaction,
    processedDomainEvent: { findUnique, findFirst },
  } as never);

  beforeEach(() => {
    jest.clearAllMocks();
    createMany.mockResolvedValue({ count: 1 });
  });

  it('passes the transaction to the effect and returns its result', async () => {
    const effect = jest.fn().mockResolvedValue('created');
    await expect(guard.runOnce('e1', 'notifications', effect)).resolves.toBe(
      'created',
    );
    expect(effect).toHaveBeenCalledWith(tx);
    expect(createMany).toHaveBeenCalledWith({
      data: { eventId: 'e1', consumer: 'notifications' },
      skipDuplicates: true,
    });
  });

  it('does not run an already committed consumer again', async () => {
    createMany.mockResolvedValue({ count: 0 });
    const effect = jest.fn();
    await expect(
      guard.runOnce('e1', 'notifications', effect),
    ).resolves.toBeUndefined();
    expect(effect).not.toHaveBeenCalled();
  });

  it('propagates effect failures so the transaction rolls back', async () => {
    await expect(
      guard.runOnce('e1', 'notifications', () =>
        Promise.reject(new Error('effect failed')),
      ),
    ).rejects.toThrow('effect failed');
  });

  it('fails closed on receipt storage errors', async () => {
    createMany.mockRejectedValueOnce(new Error('database unavailable'));
    const effect = jest.fn();
    await expect(guard.runOnce('e1', 'notifications', effect)).rejects.toThrow(
      'database unavailable',
    );
    expect(effect).not.toHaveBeenCalled();
  });

  it('wraps unversioned in-process effects in a transaction', async () => {
    const effect = jest.fn().mockResolvedValue(true);
    await expect(
      guard.runOnce(undefined, 'notifications', effect),
    ).resolves.toBe(true);
    expect(createMany).not.toHaveBeenCalled();
    expect(effect).toHaveBeenCalledWith(tx);
  });

  it('supports silent consumers and tests committed receipts', async () => {
    await expect(guard.tryClaim('e1', 'silent')).resolves.toBe(true);
    findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'receipt' });
    await expect(guard.wasProcessed('e1', 'silent')).resolves.toBe(false);
    await expect(guard.wasProcessed('e1', 'silent')).resolves.toBe(true);
  });

  it('writes a receipt inside the caller transaction', async () => {
    createMany.mockResolvedValueOnce({ count: 0 });
    await expect(guard.claim(tx as never, 'row-1', 'lookup')).resolves.toBe(
      false,
    );
    expect(createMany).toHaveBeenLastCalledWith({
      data: { eventId: 'row-1', consumer: 'lookup' },
      skipDuplicates: true,
    });
  });

  it('finds the event id a lookup consumer recorded', async () => {
    findFirst
      .mockResolvedValueOnce({ eventId: 'row-1' })
      .mockResolvedValueOnce(null);
    await expect(guard.findReceiptEventId('lookup')).resolves.toBe('row-1');
    await expect(guard.findReceiptEventId('missing')).resolves.toBeNull();
    expect(findFirst).toHaveBeenLastCalledWith({
      where: { consumer: 'missing' },
      select: { eventId: true },
    });
  });
});
