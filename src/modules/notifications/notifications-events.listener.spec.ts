import { FINANCE_NOTIFICATION_KEYS } from '../users/defaults/user-settings-defaults';
import { NotificationsEventsListener } from './notifications-events.listener';
import { NotificationsService } from './notifications.service';

describe('NotificationsEventsListener', () => {
  const notificationsService = {
    create: jest.fn(),
  } as unknown as NotificationsService;

  const listener = new NotificationsEventsListener(notificationsService);

  beforeEach(() => {
    jest.clearAllMocks();
    notificationsService.create = jest.fn().mockResolvedValue({ id: 'n-1' });
  });

  it('uses transactionDetected key for TRANSACTION_CREATED', async () => {
    await listener.onTransactionCreated({
      userId: 'user-1',
      transactionId: 'tx-1',
      amount: 100,
    });

    expect(notificationsService.create).toHaveBeenCalledWith(
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
    );
  });

  it('uses transactionDetected key for TRANSACTION_UPDATED', async () => {
    await listener.onTransactionUpdated({
      userId: 'user-1',
      transactionId: 'tx-2',
      amount: 50,
    });

    expect(notificationsService.create).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        type: 'transaction.updated',
        data: expect.objectContaining({
          notificationKey: FINANCE_NOTIFICATION_KEYS.transactionDetected,
        }),
      }),
    );
  });

  it('uses budgetAlerts key for BUDGET_THRESHOLD_REACHED', async () => {
    await listener.onBudgetThresholdReached({
      userId: 'user-1',
      budgetId: 'budget-1',
      percentageUsed: 90,
    });

    expect(notificationsService.create).toHaveBeenCalledWith(
      'user-1',
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
