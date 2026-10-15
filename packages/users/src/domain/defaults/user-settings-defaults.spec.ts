import {
  CARD_DUE_DAYS_BEFORE_MAX,
  CARD_DUE_DAYS_BEFORE_MIN,
  DEFAULT_MODULE_CONFIG_BY_SLUG,
  resolveCardDueDaysBefore,
  SUBSCRIPTION_REMINDER_DAYS_MAX,
  SUBSCRIPTION_REMINDER_DAYS_MIN,
  validateCardDueDaysBefore,
  validateSubscriptionReminderDays,
} from './user-settings-defaults';

describe('finance module defaults', () => {
  it('warns about upcoming charges 5 days ahead by default', () => {
    expect(
      DEFAULT_MODULE_CONFIG_BY_SLUG.finance.subscriptions.reminderDaysBefore,
    ).toBe(5);
  });

  it('warns about card payments 3 days ahead by default', () => {
    expect(
      DEFAULT_MODULE_CONFIG_BY_SLUG.finance.reminders.cardDueDaysBefore,
    ).toBe(3);
  });
});

describe('resolveCardDueDaysBefore', () => {
  it('reads the configured value', () => {
    expect(
      resolveCardDueDaysBefore({ reminders: { cardDueDaysBefore: 7 } }),
    ).toBe(7);
  });

  it('falls back to the default when the config is partial', () => {
    expect(resolveCardDueDaysBefore({ reminders: {} })).toBe(3);
    expect(resolveCardDueDaysBefore(null)).toBe(3);
  });
});

describe('validateCardDueDaysBefore', () => {
  it('accepts every value inside the range', () => {
    expect(validateCardDueDaysBefore(CARD_DUE_DAYS_BEFORE_MIN)).toBeNull();
    expect(validateCardDueDaysBefore(3)).toBeNull();
    expect(validateCardDueDaysBefore(CARD_DUE_DAYS_BEFORE_MAX)).toBeNull();
  });

  it('rejects values outside the range or not whole', () => {
    expect(validateCardDueDaysBefore(-1)).toContain(
      'reminders.cardDueDaysBefore',
    );
    expect(validateCardDueDaysBefore(31)).toContain(
      'reminders.cardDueDaysBefore',
    );
    expect(validateCardDueDaysBefore(3.5)).not.toBeNull();
    expect(validateCardDueDaysBefore('3')).not.toBeNull();
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
