import { BadRequestException } from '@nestjs/common';
import {
  createSettingsDescriptor,
  type JsonObject,
} from '@personal-os/contracts';
import {
  DEFAULT_MODULE_CONFIG_BY_SLUG,
  validateCardDueDaysBefore,
  validateSubscriptionReminderDays,
} from '@personal-os/users';

const financeDefaults =
  DEFAULT_MODULE_CONFIG_BY_SLUG.finance as unknown as JsonObject;

export const FINANCE_SETTINGS_DESCRIPTOR = createSettingsDescriptor({
  slug: 'finance',
  version: 2,
  defaults: financeDefaults,
  validate(config) {
    const subscriptions = config.subscriptions;
    const subscriptionDays =
      subscriptions &&
      !Array.isArray(subscriptions) &&
      typeof subscriptions === 'object'
        ? (subscriptions as Record<string, unknown>).reminderDaysBefore
        : undefined;
    if (subscriptionDays !== undefined) {
      const error = validateSubscriptionReminderDays(subscriptionDays);
      if (error) {
        throw new BadRequestException(error);
      }
    }

    const reminders = config.reminders;
    const cardDays =
      reminders && !Array.isArray(reminders) && typeof reminders === 'object'
        ? (reminders as Record<string, unknown>).cardDueDaysBefore
        : undefined;
    if (cardDays !== undefined) {
      const error = validateCardDueDaysBefore(cardDays);
      if (error) {
        throw new BadRequestException(error);
      }
    }
  },
});
