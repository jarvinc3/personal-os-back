import { AppEvents } from '@personal-os/core';
import type { SubscriptionRow } from '../infrastructure/subscriptions.repository';
import { SubscriptionRemindersService } from './subscription-reminders.service';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function subscriptionRow(
  overrides: Record<string, unknown> = {},
): SubscriptionRow {
  return {
    id: 'sub-1',
    userId: 'user-1',
    name: 'Netflix',
    normalizedKey: 'NETFLIX',
    amount: 100,
    currency: 'DOP',
    billingCycle: 'MONTHLY',
    billingInterval: 1,
    anchorDate: day('2026-01-28'),
    nextBillingDate: day('2026-02-28'),
    reminderDaysBefore: 3,
    lastRemindedFor: null,
    ...overrides,
  } as unknown as SubscriptionRow;
}

function build(options: { hasEvent?: boolean } = {}) {
  const repo = {
    findActive: jest.fn().mockResolvedValue([subscriptionRow()]),
    update: jest.fn().mockResolvedValue(subscriptionRow()),
  };
  const users = { findById: jest.fn().mockResolvedValue({ timezone: 'UTC' }) };
  const events = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const outbox = {
    hasEvent: jest.fn().mockResolvedValue(options.hasEvent ?? false),
  };
  const dispatcher = { processBatch: jest.fn().mockResolvedValue(undefined) };

  const service = new SubscriptionRemindersService(
    repo as never,
    users as never,
    events,
    outbox as never,
    dispatcher as never,
  );

  return { service, repo, events };
}

const now = new Date('2026-02-26T12:00:00.000Z');

describe('SubscriptionRemindersService', () => {
  it('raises one renewal event inside the reminder window', async () => {
    const { service, repo, events } = build();

    await service.evaluate('user-1', now);

    expect(events.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'finance-subscription-renewal:sub-1:2026-02-28',
        eventName: AppEvents.FINANCE_SUBSCRIPTION_RENEWAL_DUE,
        payload: expect.objectContaining({ daysUntil: 2 }),
      }),
    );
    expect(repo.update).toHaveBeenCalledWith(
      'user-1',
      'sub-1',
      expect.objectContaining({ lastRemindedFor: day('2026-02-28') }),
    );
  });

  it('does not repeat the reminder for the same billing date', async () => {
    const { service, repo, events } = build();
    repo.findActive.mockResolvedValue([
      subscriptionRow({ lastRemindedFor: day('2026-02-28') }),
    ]);

    await service.evaluate('user-1', now);

    expect(events.enqueue).not.toHaveBeenCalled();
  });

  it('stays quiet outside the reminder window', async () => {
    const { service, events } = build();

    await service.evaluate('user-1', new Date('2026-02-20T12:00:00.000Z'));

    expect(events.enqueue).not.toHaveBeenCalled();
  });
});
