import type {
  NotificationIntent,
  NotificationIntentSink,
} from '@personal-os/contracts';
import { FINANCE_EVENT_VERSION, FinanceEvents } from '../contracts';
import { FinanceNotificationIntents } from './finance-notification-intents';
import { FinanceNotificationsListener } from './finance-notifications.listener';

const OCCURRED_AT = '2026-11-03T00:00:00.000Z';

function emitted(overrides: Record<string, unknown> = {}) {
  return {
    eventId: 'evt-1',
    userId: 'user-1',
    aggregateType: 'Finance',
    aggregateId: 'agg-1',
    occurredAt: OCCURRED_AT,
    ...overrides,
  };
}

describe('FinanceNotificationsListener', () => {
  const submit = jest.fn().mockResolvedValue({
    accepted: true,
    notificationIds: ['n-1'],
  });
  const sink = { submit } as unknown as NotificationIntentSink;
  const listener = new FinanceNotificationsListener(
    new FinanceNotificationIntents(),
    sink,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    submit.mockResolvedValue({ accepted: true, notificationIds: ['n-1'] });
  });

  it('turns a confirmed transaction into one Finance intent', async () => {
    await listener.onTransactionConfirmed(
      emitted({
        transactionId: 'tx-1',
        amount: 1200,
        currency: 'DOP',
        status: 'CONFIRMED',
        type: 'DEBIT',
        merchant: 'Supermercado',
        accountName: 'Cuenta principal',
        categoryName: 'Comida',
      }),
    );

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0]).toMatchObject({
      sourceDomain: 'finance',
      type: 'transaction.created',
      title: 'Gasto registrado',
      preferenceKey: 'transactionDetected',
      occurredAt: OCCURRED_AT,
      cause: {
        eventId: 'evt-1',
        eventName: FinanceEvents.TRANSACTION_CONFIRMED,
      },
    });
  });

  it('passes the relay envelope to the producer with its name and version', async () => {
    const toIntents = jest.fn().mockReturnValue([]);
    const producerListener = new FinanceNotificationsListener(
      { toIntents } as never,
      sink,
    );

    await producerListener.onTransactionUpdated(emitted());

    expect(toIntents).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'evt-1',
        eventName: FinanceEvents.TRANSACTION_UPDATED,
        version: FINANCE_EVENT_VERSION,
        occurredAt: OCCURRED_AT,
        userId: 'user-1',
        aggregateType: 'Finance',
        aggregateId: 'agg-1',
        payload: expect.objectContaining({ eventId: 'evt-1' }),
      }),
    );
  });

  it('defaults the occurrence time when the payload carries none', async () => {
    await listener.onBudgetThresholdCrossed({
      eventId: 'evt-budget',
      userId: 'user-1',
      budgetId: 'budget-1',
      percentageUsed: 90,
    });

    const intent = submit.mock.calls[0][0] as NotificationIntent;
    expect(Number.isNaN(Date.parse(intent.occurredAt))).toBe(false);
    expect(intent.type).toBe('budget.threshold_reached');
  });

  it('submits every intent the producer returns', async () => {
    const first = { type: 'first' } as NotificationIntent;
    const second = { type: 'second' } as NotificationIntent;
    const producerListener = new FinanceNotificationsListener(
      { toIntents: jest.fn().mockReturnValue([first, second]) } as never,
      sink,
    );

    await producerListener.onCardPaymentDue(emitted());

    expect(submit).toHaveBeenNthCalledWith(1, first);
    expect(submit).toHaveBeenNthCalledWith(2, second);
  });

  it('sends nothing when the producer has no notice for the fact', async () => {
    await listener.onTransactionConfirmed(
      emitted({
        transactionId: 'tx-1',
        amount: 10,
        status: 'CONFIRMED',
        announce: false,
      }),
    );

    expect(submit).not.toHaveBeenCalled();
  });

  it('fails loudly when the event has no eventId', async () => {
    await expect(
      listener.onBudgetThresholdCrossed({
        userId: 'user-1',
        budgetId: 'budget-1',
        percentageUsed: 90,
      }),
    ).rejects.toThrow('arrived without an eventId');
    expect(submit).not.toHaveBeenCalled();
  });

  it('propagates a sink failure so the outbox relay retries', async () => {
    submit.mockRejectedValueOnce(new Error('delivery unavailable'));

    await expect(
      listener.onBudgetThresholdCrossed(
        emitted({ budgetId: 'budget-1', percentageUsed: 90 }),
      ),
    ).rejects.toThrow('delivery unavailable');
  });
});
