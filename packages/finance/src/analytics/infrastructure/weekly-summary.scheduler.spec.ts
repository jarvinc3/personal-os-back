import { AppEvents } from '@personal-os/core';
import type { UsersService } from '@personal-os/users';
import type { FinanceOutboxDispatcher } from '../../events/infrastructure/finance-outbox.dispatcher';
import type { PrismaOutboxRepository } from '../../events/infrastructure/prisma-outbox.repository';
import type { WeeklySummaryService } from '../application/weekly-summary.service';
import { WeeklySummaryScheduler } from './weekly-summary.scheduler';

type Recipient = { userId: string; timezone: string; day: number };

function createScheduler(recipients: Recipient[]) {
  const build = jest.fn().mockResolvedValue({ weekStart: '2026-10-12' });
  const listWeeklySummaryRecipients = jest.fn().mockResolvedValue(recipients);
  const enqueue = jest.fn().mockResolvedValue(undefined);
  const hasEvent = jest.fn().mockResolvedValue(false);
  const processBatch = jest.fn().mockResolvedValue(undefined);

  const scheduler = new WeeklySummaryScheduler(
    { listWeeklySummaryRecipients } as unknown as UsersService,
    { build } as unknown as WeeklySummaryService,
    { enqueue },
    { hasEvent } as unknown as PrismaOutboxRepository,
    { processBatch } as unknown as FinanceOutboxDispatcher,
  );

  return { scheduler, build, enqueue, hasEvent, processBatch };
}

const MONDAY_8AM_UTC = new Date('2026-10-19T08:00:00.000Z');

describe('WeeklySummaryScheduler', () => {
  it('sends the previous completed week on the chosen day at 08:00', async () => {
    const { scheduler, build, enqueue, processBatch } = createScheduler([
      { userId: 'user-1', timezone: 'UTC', day: 1 },
    ]);

    await scheduler.handleCron(MONDAY_8AM_UTC);

    expect(build).toHaveBeenCalledWith('user-1', '2026-10-12');
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'finance-weekly-summary:user-1:2026-10-12',
        eventName: AppEvents.FINANCE_WEEKLY_SUMMARY,
        payload: {
          weekStart: '2026-10-12',
          summary: { weekStart: '2026-10-12' },
        },
      }),
    );
    expect(processBatch).toHaveBeenCalled();
  });

  it('uses the user timezone to decide the hour', async () => {
    const { scheduler, build } = createScheduler([
      { userId: 'user-1', timezone: 'America/Santo_Domingo', day: 1 },
    ]);

    await scheduler.handleCron(new Date('2026-10-19T12:00:00.000Z'));

    expect(build).toHaveBeenCalledWith('user-1', '2026-10-12');
  });

  it('skips every other hour', async () => {
    const { scheduler, build } = createScheduler([
      { userId: 'user-1', timezone: 'UTC', day: 1 },
    ]);

    await scheduler.handleCron(new Date('2026-10-19T09:00:00.000Z'));

    expect(build).not.toHaveBeenCalled();
  });

  it('skips recipients whose day is not today', async () => {
    const { scheduler, build } = createScheduler([
      { userId: 'user-1', timezone: 'UTC', day: 3 },
    ]);

    await scheduler.handleCron(MONDAY_8AM_UTC);

    expect(build).not.toHaveBeenCalled();
  });

  it('does not send twice for the same week', async () => {
    const { scheduler, build, enqueue, hasEvent } = createScheduler([
      { userId: 'user-1', timezone: 'UTC', day: 1 },
    ]);
    hasEvent.mockResolvedValue(true);

    await scheduler.handleCron(MONDAY_8AM_UTC);

    expect(build).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
