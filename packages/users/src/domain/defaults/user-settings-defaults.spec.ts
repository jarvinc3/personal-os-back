import {
  DEFAULT_MODULE_CONFIG_BY_SLUG,
  SUBSCRIPTION_REMINDER_DAYS_MAX,
  SUBSCRIPTION_REMINDER_DAYS_MIN,
  validateSubscriptionReminderDays,
} from './user-settings-defaults';

describe('finance module defaults', () => {
  it('warns about upcoming charges 5 days ahead by default', () => {
    expect(
      DEFAULT_MODULE_CONFIG_BY_SLUG.finance.subscriptions.reminderDaysBefore,
    ).toBe(5);
  });
});

describe('validateSubscriptionReminderDays', () => {
  it('accepts every value inside the range', () => {
    expect(
      validateSubscriptionReminderDays(SUBSCRIPTION_REMINDER_DAYS_MIN),
    ).toBeNull();
    expect(validateSubscriptionReminderDays(5)).toBeNull();
    expect(
      validateSubscriptionReminderDays(SUBSCRIPTION_REMINDER_DAYS_MAX),
    ).toBeNull();
  });

  it('rejects values outside the range', () => {
    expect(validateSubscriptionReminderDays(0)).toContain(
      'subscriptions.reminderDaysBefore',
    );
    expect(validateSubscriptionReminderDays(31)).toContain(
      'subscriptions.reminderDaysBefore',
    );
  });

  it('rejects values that are not whole numbers', () => {
    expect(validateSubscriptionReminderDays(3.5)).not.toBeNull();
    expect(validateSubscriptionReminderDays('5')).not.toBeNull();
    expect(validateSubscriptionReminderDays(null)).not.toBeNull();
  });
});
