import { FinanceEvents } from '../../contracts';
import { WeeklySummaryNotifier } from './weekly-summary-notifier';
import type { WeeklySummary } from './weekly-summary.types';

function createNotifier() {
  const enqueue = jest.fn().mockResolvedValue(undefined);
  const hasEvent = jest.fn().mockResolvedValue(false);
  const wake = jest.fn().mockResolvedValue(undefined);
  const notifier = new WeeklySummaryNotifier(
    { enqueue },
    { hasEvent },
    { wake },
  );
  return { notifier, enqueue, hasEvent, wake };
}

describe('WeeklySummaryNotifier', () => {
  it('enqueues the summary once and wakes the relay', async () => {
    const { notifier, enqueue, wake } = createNotifier();
    const summary = { weekStart: '2026-10-12' } as unknown as WeeklySummary;

    await notifier.notify({
      userId: 'user-1',
      weekStart: '2026-10-12',
      summary,
    });

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'finance-weekly-summary:user-1:2026-10-12',
        eventName: FinanceEvents.WEEKLY_SUMMARY,
        aggregateId: 'user-1',
        payload: { weekStart: '2026-10-12', summary },
      }),
    );
    expect(wake).toHaveBeenCalled();
  });

  it('asks the outbox with the stable id of the week', async () => {
    const { notifier, hasEvent } = createNotifier();

    await notifier.hasBeenSent('user-1', '2026-10-12');

    expect(hasEvent).toHaveBeenCalledWith(
      'finance-weekly-summary:user-1:2026-10-12',
    );
  });
});
