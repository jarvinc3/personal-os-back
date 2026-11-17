import { FinanceEvents } from '../../contracts';
import { RecurringAlertsService } from './recurring-alerts.service';
import type { RecurringPatternWithMerchant } from './recurring.service';

function pattern(nextExpectedDate: Date): RecurringPatternWithMerchant {
  return {
    id: 'pattern-1',
    merchant: 'Netflix',
    currency: 'DOP',
    avgAmount: { toString: () => '500.00' },
    nextExpectedDate,
    merchantRef: { name: 'Netflix', logoUrl: null, categoryId: null },
  };
}

function build(hasEvent = false) {
  const events = { enqueue: jest.fn() };
  const outbox = { hasEvent: jest.fn().mockResolvedValue(hasEvent) };
  const relay = { wake: jest.fn().mockResolvedValue(0) };
  return {
    service: new RecurringAlertsService(events, outbox, relay),
    events,
  };
}

const now = new Date(Date.UTC(2026, 5, 10));

describe('RecurringAlertsService', () => {
  it('raises an upcoming event inside the reminder window', async () => {
    const { service, events } = build();
    await service.evaluate(
      'user-1',
      {
        patterns: [pattern(new Date(Date.UTC(2026, 5, 12)))],
        priceChanges: [],
      },
      now,
    );

    expect(events.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: FinanceEvents.RECURRING_UPCOMING,
        userId: 'user-1',
        payload: expect.objectContaining({ daysUntil: 2 }),
      }),
    );
  });

  it('raises a missed event once the tolerance passes', async () => {
    const { service, events } = build();
    await service.evaluate(
      'user-1',
      {
        patterns: [pattern(new Date(Date.UTC(2026, 5, 1)))],
        priceChanges: [],
      },
      now,
    );

    expect(events.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: FinanceEvents.RECURRING_MISSED,
      }),
    );
  });

  it('raises a price change event', async () => {
    const { service, events } = build();
    await service.evaluate(
      'user-1',
      {
        patterns: [],
        priceChanges: [
          {
            patternId: 'pattern-1',
            merchant: 'Netflix',
            currency: 'DOP',
            previousAmount: 500,
            newAmount: 600,
          },
        ],
      },
      now,
    );

    expect(events.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: FinanceEvents.RECURRING_PRICE_CHANGED,
        eventId: 'finance-recurring-price:pattern-1:600',
      }),
    );
  });

  it('does not enqueue an event that already ran', async () => {
    const { service, events } = build(true);
    await service.evaluate(
      'user-1',
      {
        patterns: [pattern(new Date(Date.UTC(2026, 5, 12)))],
        priceChanges: [],
      },
      now,
    );

    expect(events.enqueue).not.toHaveBeenCalled();
  });
});
