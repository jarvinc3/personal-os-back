import type { DomainEventIdempotencyGuard } from '../../finance/events/application/domain-event-idempotency.guard';
import { FINANCE_NOTIFICATION_KEYS } from '../../users/domain/defaults/user-settings-defaults';
import { NotificationsEventsListener } from './notifications-events.listener';
import { NotificationsService } from './notifications.service';

describe('NotificationsEventsListener', () => {
  const create = jest.fn();
  const tryClaim = jest.fn().mockResolvedValue(true);

  const notificationsService = {
    create,
  } as unknown as NotificationsService;

  const idempotency = {
    tryClaim,
  } as unknown as DomainEventIdempotencyGuard;

  const listener = new NotificationsEventsListener(
    notificationsService,
    idempotency,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    create.mockResolvedValue({ id: 'n-1' });
    tryClaim.mockResolvedValue(true);
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
    ]);
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
});
