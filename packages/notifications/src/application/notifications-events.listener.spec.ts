import type { DomainEventIdempotencyGuard } from '@personal-os/core';
import { FINANCE_NOTIFICATION_KEYS } from '@personal-os/users';
import { NotificationsEventsListener } from './notifications-events.listener';
import { NotificationsService } from './notifications.service';

describe('NotificationsEventsListener', () => {
  const create = jest.fn();
  const tx = {};
  const runOnce = jest.fn((_eventId, _consumer, effect) => effect(tx));
  const publishInApp = jest.fn();
  const tryClaim = jest.fn().mockResolvedValue(true);

  const notificationsService = {
    create,
    publishInApp,
  } as unknown as NotificationsService;

  const idempotency = {
    tryClaim,
    runOnce,
  } as unknown as DomainEventIdempotencyGuard;

  const listener = new NotificationsEventsListener(
    notificationsService,
    idempotency,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    create.mockResolvedValue({ id: 'n-1' });
    tryClaim.mockResolvedValue(true);
    runOnce.mockImplementation((_eventId, _consumer, effect) => effect(tx));
  });

  it('uses transactionDetected key for CONFIRMED finance.transaction.confirmed', async () => {
    await listener.onFinanceTransactionCreated({
      userId: 'user-1',
      transactionId: 'tx-1',
      amount: 100,
      status: 'CONFIRMED',
      source: 'MANUAL',
      eventId: 'evt-1',
    });

    expect(create.mock.calls[0]).toEqual([
      'user-1',
      expect.objectContaining({
        type: 'transaction.created',
        channel: 'IN_APP',
        data: expect.objectContaining({
          moduleSlug: 'finance',
          notificationKey: FINANCE_NOTIFICATION_KEYS.transactionDetected,
          transactionId: 'tx-1',
        }),
      }),
      tx,
    ]);
  });

  it('stays quiet when the movement is a side effect the user already saw', async () => {
    await listener.onFinanceTransactionCreated({
      userId: 'user-1',
      transactionId: 'tx-goal',
      amount: 100,
      status: 'CONFIRMED',
      source: 'MANUAL',
      transferGroupId: 'group-goal',
      legRole: 'SOURCE',
      announce: false,
      eventId: 'evt-goal',
    });

    expect(create).not.toHaveBeenCalled();
  });

  it('still announces a movement created by email', async () => {
    await listener.onFinanceTransactionCreated({
      userId: 'user-1',
      transactionId: 'tx-email',
      amount: 100,
      status: 'CONFIRMED',
      source: 'EMAIL',
      eventId: 'evt-email',
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][1]).toEqual(
      expect.objectContaining({ type: 'transaction.created' }),
    );
  });

  it('notifies a transfer once, from the source leg', async () => {
    await listener.onFinanceTransactionCreated({
      userId: 'user-1',
      transactionId: 'tx-transfer-out',
      amount: 500,
      status: 'CONFIRMED',
      source: 'MANUAL',
      transferGroupId: 'group-1',
      legRole: 'SOURCE',
      accountName: 'Cuenta principal',
      eventId: 'evt-transfer-out',
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        type: 'transaction.transfer',
        title: 'Transferencia registrada',
      }),
    );
    expect(runOnce).toHaveBeenCalledWith(
      'group-1',
      expect.stringContaining(':transfer'),
      expect.any(Function),
    );
  });

  it('skips the destination leg of a transfer', async () => {
    await listener.onFinanceTransactionCreated({
      userId: 'user-1',
      transactionId: 'tx-transfer-in',
      amount: 500,
      status: 'CONFIRMED',
      source: 'MANUAL',
      transferGroupId: 'group-1',
      legRole: 'DESTINATION',
      accountName: 'Cuenta ahorro',
      eventId: 'evt-transfer-in',
    });

    expect(create).not.toHaveBeenCalled();
  });

  it('skips a transfer whose group was already notified', async () => {
    runOnce.mockResolvedValueOnce(undefined);

    await listener.onFinanceTransactionCreated({
      userId: 'user-1',
      transactionId: 'tx-transfer-out',
      amount: 500,
      status: 'CONFIRMED',
      transferGroupId: 'group-1',
      legRole: 'SOURCE',
      eventId: 'evt-transfer-out',
    });

    expect(create).not.toHaveBeenCalled();
  });

  it('uses pending import message for EMAIL PENDING', async () => {
    await listener.onFinanceTransactionCreated({
      userId: 'user-1',
      transactionId: 'tx-1',
      amount: 100,
      status: 'PENDING',
      source: 'EMAIL',
      eventId: 'evt-2',
    });

    expect(create.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        type: 'transaction.imported_pending',
      }),
    );
  });

  it('uses transactionDetected key for finance.transaction.updated', async () => {
    await listener.onFinanceTransactionUpdated({
      userId: 'user-1',
      transactionId: 'tx-2',
      amount: 50,
      status: 'CONFIRMED',
      eventId: 'evt-3',
    });

    expect(create.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        type: 'transaction.updated',
        data: expect.objectContaining({
          notificationKey: FINANCE_NOTIFICATION_KEYS.transactionDetected,
        }),
      }),
    );
  });

  it('uses budgetAlerts key for finance.budget.threshold_crossed', async () => {
    await listener.onBudgetThreshold({
      userId: 'user-1',
      budgetId: 'budget-1',
      percentageUsed: 90,
      eventId: 'evt-4',
    });

    expect(create.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        type: 'budget.threshold_reached',
        data: expect.objectContaining({
          notificationKey: FINANCE_NOTIFICATION_KEYS.budgetAlerts,
          budgetId: 'budget-1',
        }),
      }),
    );
  });

  it('claims finance.transaction.deleted without creating an in-app notification', async () => {
    await listener.onFinanceTransactionDeleted({
      userId: 'user-1',
      transactionId: 'tx-del',
      amount: 50,
      status: 'CONFIRMED',
      source: 'MANUAL',
      eventId: 'evt-del',
    });

    expect(tryClaim).toHaveBeenCalledWith('evt-del', 'notifications:deleted');
    expect(create).not.toHaveBeenCalled();
  });
  it('propagates persistence failure without publishing a socket update', async () => {
    create.mockRejectedValueOnce(new Error('database failed'));
    await expect(
      listener.onBudgetThreshold({
        userId: 'u1',
        budgetId: 'b1',
        percentageUsed: 90,
        eventId: 'e1',
      }),
    ).rejects.toThrow('database failed');
    expect(publishInApp).not.toHaveBeenCalled();
  });

  it('publishes only after the receipt transaction resolves', async () => {
    runOnce.mockImplementationOnce(async (_id, _consumer, effect) => {
      const created = await effect(tx);
      expect(publishInApp).not.toHaveBeenCalled();
      return created;
    });
    await listener.onBudgetThreshold({
      userId: 'u1',
      budgetId: 'b1',
      percentageUsed: 90,
      eventId: 'e1',
    });
    expect(publishInApp).toHaveBeenCalledTimes(1);
  });
});
