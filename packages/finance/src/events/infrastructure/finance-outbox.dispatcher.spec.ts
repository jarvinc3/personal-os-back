import { EventEmitter2 } from '@nestjs/event-emitter';
import { FinanceOutboxDispatcher } from './finance-outbox.dispatcher';

describe('FinanceOutboxDispatcher', () => {
  it('claims a pending event, emits, then marks COMPLETED', async () => {
    const row = {
      id: '1',
      eventId: 'evt-1',
      eventName: 'finance.transaction.confirmed',
      userId: 'user-1',
      aggregateType: 'FinTransaction',
      aggregateId: 'tx-1',
      payload: { amount: 10 },
      attempts: 0,
      status: 'PENDING',
    };

    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(row)
      .mockResolvedValue(null);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findUnique = jest
      .fn()
      .mockResolvedValue({ ...row, attempts: 1, status: 'PROCESSING' });
    const update = jest.fn().mockResolvedValue({});
    const emitAsync = jest.fn().mockResolvedValue([]);

    const prisma = {
      domainEventOutbox: { findFirst, updateMany, findUnique, update },
    };

    const dispatcher = new FinanceOutboxDispatcher(
      prisma as never,
      { emitAsync } as unknown as EventEmitter2,
    );

    const processed = await dispatcher.processBatch();
    expect(processed).toBe(1);
    expect(emitAsync).toHaveBeenCalledWith(
      'finance.transaction.confirmed',
      expect.objectContaining({ eventId: 'evt-1', userId: 'user-1' }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    );
  });

  it('marks DEAD after max attempts on failure', async () => {
    const row = {
      id: '1',
      eventId: 'evt-1',
      eventName: 'finance.transaction.confirmed',
      userId: 'user-1',
      aggregateType: 'FinTransaction',
      aggregateId: 'tx-1',
      payload: {},
      attempts: 7,
      status: 'FAILED',
    };

    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(row)
      .mockResolvedValue(null);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findUnique = jest
      .fn()
      .mockResolvedValue({ ...row, attempts: 8, status: 'PROCESSING' });
    const update = jest.fn().mockResolvedValue({});
    const emitAsync = jest.fn().mockRejectedValue(new Error('boom'));

    const prisma = {
      domainEventOutbox: { findFirst, updateMany, findUnique, update },
    };

    const dispatcher = new FinanceOutboxDispatcher(
      prisma as never,
      { emitAsync } as unknown as EventEmitter2,
    );

    await dispatcher.processBatch();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'DEAD' }),
      }),
    );
  });
});
