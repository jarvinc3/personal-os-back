import { FinanceEvents } from '../../contracts';
import type { UsersService } from '@personal-os/users';
import type { WeeklySummaryService } from '../application/weekly-summary.service';
import { WeeklySummaryScheduler } from './weekly-summary.scheduler';

type ModuleConfig = { userId: string; timezone: string; config: unknown };

function createScheduler(moduleConfigs: ModuleConfig[]) {
  const build = jest.fn().mockResolvedValue({ weekStart: '2026-10-12' });
  const listEnabledModuleConfigs = jest.fn().mockResolvedValue(moduleConfigs);
  const enqueue = jest.fn().mockResolvedValue(undefined);
  const hasEvent = jest.fn().mockResolvedValue(false);
  const wake = jest.fn().mockResolvedValue(undefined);

  const scheduler = new WeeklySummaryScheduler(
    { listEnabledModuleConfigs } as unknown as UsersService,
    { build } as unknown as WeeklySummaryService,
    { enqueue },
    { hasEvent },
    { wake },
  );

  return {
    scheduler,
    build,
    enqueue,
    hasEvent,
    wake,
    listEnabledModuleConfigs,
  };
}

const MONDAY_8AM_UTC = new Date('2026-10-19T08:00:00.000Z');

describe('WeeklySummaryScheduler', () => {
  it('sends the previous completed week on the chosen day at 08:00', async () => {
    const { scheduler, build, enqueue, wake, listEnabledModuleConfigs } =
      createScheduler([
        {
          userId: 'user-1',
          timezone: 'UTC',
          config: { reports: { weeklySummaryDay: 1 } },
        },
      ]);

    await scheduler.handleCron(MONDAY_8AM_UTC);

    expect(listEnabledModuleConfigs).toHaveBeenCalledWith('finance');
    expect(build).toHaveBeenCalledWith('user-1', '2026-10-12');
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'finance-weekly-summary:user-1:2026-10-12',
        eventName: FinanceEvents.WEEKLY_SUMMARY,
        payload: {
          weekStart: '2026-10-12',
          summary: { weekStart: '2026-10-12' },
        },
      }),
    );
    expect(wake).toHaveBeenCalled();
  });

  it('uses the user timezone to decide the hour', async () => {
    const { scheduler, build } = createScheduler([
      {
        userId: 'user-1',
        timezone: 'America/Santo_Domingo',
        config: { reports: { weeklySummaryDay: 1 } },
      },
    ]);

    await scheduler.handleCron(new Date('2026-10-19T12:00:00.000Z'));

    expect(build).toHaveBeenCalledWith('user-1', '2026-10-12');
  });

  it('skips every other hour', async () => {
    const { scheduler, build } = createScheduler([
      {
        userId: 'user-1',
        timezone: 'UTC',
        config: { reports: { weeklySummaryDay: 1 } },
      },
    ]);

    await scheduler.handleCron(new Date('2026-10-19T09:00:00.000Z'));

    expect(build).not.toHaveBeenCalled();
  });

  it('skips recipients whose day is not today', async () => {
    const { scheduler, build } = createScheduler([
      {
        userId: 'user-1',
        timezone: 'UTC',
        config: { reports: { weeklySummaryDay: 3 } },
      },
    ]);

    await scheduler.handleCron(MONDAY_8AM_UTC);

    expect(build).not.toHaveBeenCalled();
  });

  it('defaults to Monday when the report day is not configured', async () => {
    const { scheduler, build } = createScheduler([
      { userId: 'user-1', timezone: 'UTC', config: {} },
    ]);

    await scheduler.handleCron(MONDAY_8AM_UTC);

    expect(build).toHaveBeenCalledWith('user-1', '2026-10-12');
  });

  it('skips users who turned the weekly summary off', async () => {
    const { scheduler, build } = createScheduler([
      {
        userId: 'user-1',
        timezone: 'UTC',
        config: { notifications: { weeklySummary: false } },
      },
    ]);

    await scheduler.handleCron(MONDAY_8AM_UTC);

    expect(build).not.toHaveBeenCalled();
  });

  it('does not send twice for the same week', async () => {
    const { scheduler, build, enqueue, hasEvent } = createScheduler([
      {
        userId: 'user-1',
        timezone: 'UTC',
        config: { reports: { weeklySummaryDay: 1 } },
      },
    ]);
    hasEvent.mockResolvedValue(true);

    await scheduler.handleCron(MONDAY_8AM_UTC);

    expect(build).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
