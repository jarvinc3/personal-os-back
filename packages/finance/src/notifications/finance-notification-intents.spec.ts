import type { NotificationIntent } from '@personal-os/contracts';
import type {
  FinanceDomainEvent,
  FinanceEventName,
  FinanceEventPayloads,
} from '../contracts';
import { FINANCE_EVENT_VERSION, FinanceEvents } from '../contracts';
import { FINANCE_NOTIFICATION_KEYS } from '../settings/finance-settings';
import { FinanceNotificationIntents } from './finance-notification-intents';

function financeEvent<TName extends FinanceEventName>(input: {
  eventName: TName;
  payload: FinanceEventPayloads[TName];
  eventId?: string;
  userId?: string | null;
}): FinanceDomainEvent<TName> {
  return {
    eventId: input.eventId ?? 'evt-1',
    eventName: input.eventName,
    version: FINANCE_EVENT_VERSION,
    occurredAt: '2026-11-03T00:00:00.000Z',
    userId: input.userId === undefined ? 'user-1' : input.userId,
    aggregateType: 'Finance',
    aggregateId: 'agg-1',
    payload: input.payload,
  };
}

function transactionPayload(
  overrides: Partial<
    FinanceEventPayloads[typeof FinanceEvents.TRANSACTION_CONFIRMED]
  > = {},
): FinanceEventPayloads[typeof FinanceEvents.TRANSACTION_CONFIRMED] {
  return {
    transactionId: 'tx-1',
    amount: 1200,
    currency: 'DOP',
    status: 'CONFIRMED',
    type: 'DEBIT',
    merchant: 'Supermercado',
    accountName: 'Cuenta principal',
    cardName: null,
    categoryName: 'Comida',
    ...overrides,
  };
}

describe('FinanceNotificationIntents', () => {
  const intents = new FinanceNotificationIntents();

  function adapt(
    event: Parameters<FinanceNotificationIntents['toIntents']>[0],
  ): readonly NotificationIntent[] {
    return intents.toIntents(event);
  }

  it('creates one transaction notice with the recorded copy and preference', () => {
    const [intent] = adapt(
      financeEvent({
        eventName: FinanceEvents.TRANSACTION_CONFIRMED,
        payload: transactionPayload(),
      }),
    );

    expect(intent).toMatchObject({
      schemaVersion: 1,
      userId: 'user-1',
      sourceDomain: 'finance',
      type: 'transaction.created',
      preferenceKey: FINANCE_NOTIFICATION_KEYS.transactionDetected,
      title: 'Gasto registrado',
      body: 'DOP $1,200.00 · Supermercado · Comida · Cuenta principal',
      requestedChannels: ['IN_APP'],
      occurredAt: '2026-11-03T00:00:00.000Z',
      cause: {
        eventId: 'evt-1',
        eventName: FinanceEvents.TRANSACTION_CONFIRMED,
      },
      data: expect.objectContaining({
        moduleSlug: 'finance',
        notificationKey: FINANCE_NOTIFICATION_KEYS.transactionDetected,
        transactionId: 'tx-1',
        amount: 1200,
      }),
    });
  });

  it('announces a transfer once, from the source leg, with the group identity', () => {
    const source = financeEvent({
      eventName: FinanceEvents.TRANSACTION_CONFIRMED,
      payload: transactionPayload({
        transferGroupId: 'group-1',
        legRole: 'SOURCE',
      }),
    });
    const [intent] = adapt(source);

    expect(intent).toMatchObject({
      type: 'transaction.transfer',
      title: 'Transferencia registrada',
      body: 'DOP $1,200.00 · Cuenta principal',
      deduplicationKey: 'finance:transaction.transfer:group-1',
    });
    expect(
      adapt({
        ...source,
        eventId: 'evt-leg-2',
        payload: { ...source.payload, legRole: 'DESTINATION' },
      }),
    ).toEqual([]);
  });

  it('stays quiet for a movement the user already saw or that is not confirmed', () => {
    expect(
      adapt(
        financeEvent({
          eventName: FinanceEvents.TRANSACTION_CONFIRMED,
          payload: transactionPayload({ announce: false }),
        }),
      ),
    ).toEqual([]);
    expect(
      adapt(
        financeEvent({
          eventName: FinanceEvents.TRANSACTION_CONFIRMED,
          payload: transactionPayload({ status: 'DECLINED' }),
        }),
      ),
    ).toEqual([]);
    expect(
      adapt(
        financeEvent({
          eventName: FinanceEvents.TRANSACTION_DELETED,
          payload: {
            transactionId: 'tx-1',
            transferGroupId: null,
            amount: 10,
            status: 'CONFIRMED',
            source: 'MANUAL',
          },
        }),
      ),
    ).toEqual([]);
  });

  it('uses the updated copy for an edited movement', () => {
    const [intent] = adapt(
      financeEvent({
        eventName: FinanceEvents.TRANSACTION_UPDATED,
        payload: transactionPayload({ merchant: null }),
      }),
    );

    expect(intent).toMatchObject({
      type: 'transaction.updated',
      title: 'Movimiento actualizado',
      body: 'Se actualizó DOP $1,200.00 · Comida.',
    });
  });

  it('creates the budget threshold notice with its rounded copy', () => {
    const [intent] = adapt(
      financeEvent({
        eventName: FinanceEvents.BUDGET_THRESHOLD_CROSSED,
        payload: {
          budgetId: 'budget-1',
          percentageUsed: 89.6,
          alertId: 'alert-1',
        },
      }),
    );

    expect(intent).toMatchObject({
      type: 'budget.threshold_reached',
      title: 'Presupuesto al 90%',
      body: 'Un presupuesto alcanzó el 90% de su límite.',
      preferenceKey: FINANCE_NOTIFICATION_KEYS.budgetAlerts,
      data: expect.objectContaining({ budgetId: 'budget-1' }),
    });
  });

  it('keeps the statement reminder without a preference toggle', () => {
    const [intent] = adapt(
      financeEvent({
        eventName: FinanceEvents.CARD_STATEMENT_REMINDER,
        payload: { sourceId: 'source-1' },
      }),
    );

    expect(intent).toMatchObject({
      type: 'card.statement_reminder',
      title: 'Carga el corte de tu tarjeta',
      data: expect.objectContaining({ reminder: 'card_statement' }),
    });
    expect(intent.preferenceKey).toBeUndefined();
  });

  it('names the card and the remaining amount in the due notice', () => {
    const [intent] = adapt(
      financeEvent({
        eventName: FinanceEvents.CARD_PAYMENT_DUE,
        payload: {
          cardId: 'card-1',
          statementId: 'statement-1',
          cardName: ' ',
          currency: 'DOP',
          closingBalance: 2000,
          remaining: 1500,
          minimumPayment: 300,
          dueDate: '2026-11-10',
          daysUntil: 2,
        },
      }),
    );

    expect(intent).toMatchObject({
      type: 'card.payment_due',
      title: 'Pago de tarjeta próximo',
      body: 'El corte de tu tarjeta vence en 2 días. Falta por pagar DOP $1,500.00.',
      preferenceKey: FINANCE_NOTIFICATION_KEYS.cardDueDate,
      data: expect.objectContaining({
        cardId: 'card-1',
        dueDate: '2026-11-10',
      }),
    });
  });

  it('summarizes the week with the details that exist', () => {
    const [intent] = adapt(
      financeEvent({
        eventName: FinanceEvents.WEEKLY_SUMMARY,
        payload: {
          weekStart: '2026-10-12',
          summary: {
            currency: 'DOP',
            expenses: '500.00',
            averageExpenses: '250.00',
            topCategories: [{ name: 'Comida' }],
            budgetsAtRisk: [{ id: 'b-1' }],
            upcomingInstallments: [],
            pendingEmails: 2,
          },
        },
      }),
    );

    expect(intent).toMatchObject({
      type: 'finance.weekly_summary',
      title: 'Resumen semanal',
      body: 'Gastaste DOP $500.00 · promedio DOP $250.00 · Top: Comida · 1 presupuestos en riesgo · 2 correos por revisar',
      preferenceKey: FINANCE_NOTIFICATION_KEYS.weeklySummary,
      data: expect.objectContaining({ weekStart: '2026-10-12' }),
    });
  });

  it('creates the recurring price and charge notices', () => {
    const [priceChanged] = adapt(
      financeEvent({
        eventName: FinanceEvents.RECURRING_PRICE_CHANGED,
        payload: {
          patternId: 'pattern-1',
          merchant: 'Netflix',
          currency: 'USD',
          previousAmount: 10,
          newAmount: 12,
        },
      }),
    );
    const [missed] = adapt(
      financeEvent({
        eventName: FinanceEvents.RECURRING_MISSED,
        payload: {
          patternId: 'pattern-1',
          merchant: 'Netflix',
          amount: 12,
          currency: 'USD',
          nextExpectedDate: '2026-11-01',
        },
      }),
    );
    const [upcoming] = adapt(
      financeEvent({
        eventName: FinanceEvents.RECURRING_UPCOMING,
        payload: {
          patternId: 'pattern-1',
          merchant: 'Netflix',
          amount: 12,
          currency: 'USD',
          nextExpectedDate: '2026-11-08',
          daysUntil: 3,
        },
      }),
    );

    expect(priceChanged).toMatchObject({
      type: 'recurring.price_changed',
      body: 'Netflix pasó de USD $10.00 a USD $12.00.',
      preferenceKey: FINANCE_NOTIFICATION_KEYS.priceIncreaseAlerts,
    });
    expect(missed).toMatchObject({
      type: 'recurring.missed',
      body: 'El cobro de Netflix (USD $12.00) no llegó en la fecha esperada.',
      preferenceKey: FINANCE_NOTIFICATION_KEYS.recurringAlerts,
    });
    expect(upcoming).toMatchObject({
      type: 'recurring.upcoming',
      body: 'Netflix cobra USD $12.00 en 3 días.',
      preferenceKey: FINANCE_NOTIFICATION_KEYS.recurringAlerts,
    });
  });

  it('creates the subscription renewal notice', () => {
    const [intent] = adapt(
      financeEvent({
        eventName: FinanceEvents.SUBSCRIPTION_RENEWAL_DUE,
        payload: {
          subscriptionId: 'sub-1',
          name: 'Spotify',
          amount: 5.99,
          currency: 'USD',
          nextBillingDate: '2026-11-04',
          daysUntil: 1,
        },
      }),
    );

    expect(intent).toMatchObject({
      type: 'subscription.renewal_due',
      title: 'Renovación próxima',
      body: 'Tu suscripción Spotify se renueva mañana por USD $5.99.',
      preferenceKey: FINANCE_NOTIFICATION_KEYS.subscriptionReminders,
    });
  });

  it('creates the balance drift notice with a fallback account name', () => {
    const [intent] = adapt(
      financeEvent({
        eventName: FinanceEvents.BALANCE_DRIFT_DETECTED,
        payload: {
          driftId: 'drift-1',
          accountId: 'account-1',
          cardId: null,
          currency: 'DOP',
          name: null,
          storedBalance: '100.00',
          expectedBalance: '74.50',
          difference: '25.50',
        },
      }),
    );

    expect(intent).toMatchObject({
      type: 'finance.balance_drift',
      title: 'Saldo descuadrado',
      body: 'El saldo de una cuenta no coincide con sus movimientos (DOP $25.50).',
      preferenceKey: FINANCE_NOTIFICATION_KEYS.balanceIntegrity,
    });
  });

  it('keeps a stable deduplication key for the same fact', () => {
    const event = financeEvent({
      eventName: FinanceEvents.TRANSACTION_UPDATED,
      payload: transactionPayload(),
      eventId: 'evt-stable',
    });

    const [first] = adapt(event);
    const [retry] = adapt({ ...event });
    const [other] = adapt({ ...event, eventId: 'evt-other' });

    expect(first.deduplicationKey).toBe(
      'finance:transaction.updated:evt-stable',
    );
    expect(retry.deduplicationKey).toBe(first.deduplicationKey);
    expect(other.deduplicationKey).not.toBe(first.deduplicationKey);
  });

  it('creates no intent without an owner', () => {
    expect(
      adapt(
        financeEvent({
          eventName: FinanceEvents.CARD_STATEMENT_REMINDER,
          payload: {},
          userId: null,
        }),
      ),
    ).toEqual([]);
  });
});
