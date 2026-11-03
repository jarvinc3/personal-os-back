import { BadRequestException } from '@nestjs/common';
import { FINANCE_SETTINGS_DESCRIPTOR } from './settings.descriptor';

describe('Finance settings descriptor', () => {
  it('keeps the current Finance defaults and nested merge behavior', () => {
    expect(
      FINANCE_SETTINGS_DESCRIPTOR.normalize({
        display: { showCents: false },
      }),
    ).toMatchObject({
      version: 2,
      baseCurrency: 'DOP',
      display: { showCents: false, compactNumbers: false },
      notifications: { budgetAlerts: true, monthlyReport: false },
    });
  });

  it('delegates Finance range validation to its registered descriptor', () => {
    expect(() =>
      FINANCE_SETTINGS_DESCRIPTOR.applyPatch(
        FINANCE_SETTINGS_DESCRIPTOR.defaults,
        { subscriptions: { reminderDaysBefore: 31 } },
      ),
    ).toThrow(BadRequestException);
  });
});
