import {
  GLOBAL_USER_PREFERENCES_DEFAULTS,
  type AiTone,
  type ParsedUserPreferences,
  type WeekStartsOn,
} from './defaults/global-preferences-defaults';
import { mergeWithDefaults } from './settings-merge';
import { isWeekStartsOn, weekStartsOnFromLocale } from './week-starts-on';

export type ParseUserPreferencesOptions = {
  /** IANA zone used when quiet hours carry none. */
  timezone?: string | null;
  locale: string;
};

function isAiTone(value: unknown): value is AiTone {
  return value === 'concise' || value === 'balanced' || value === 'detailed';
}

function readStoredWeekStartsOn(value: unknown): WeekStartsOn | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isWeekStartsOn(value)) {
    throw new Error(
      `Invalid regional.weekStartsOn stored on the user profile: ${JSON.stringify(value)}`,
    );
  }
  return value;
}

export function parseUserPreferences(
  raw: unknown,
  options: ParseUserPreferencesOptions,
): ParsedUserPreferences {
  const merged = mergeWithDefaults(
    typeof raw === 'object' && raw !== null ? raw : {},
    GLOBAL_USER_PREFERENCES_DEFAULTS as unknown as Record<string, unknown>,
  ) as {
    regional: Record<string, unknown>;
    ai: Record<string, unknown>;
    notifications: Record<string, unknown>;
  };

  const regionalRaw = merged.regional ?? {};
  const storedWeekStartsOn = readStoredWeekStartsOn(regionalRaw.weekStartsOn);

  const aiRaw = merged.ai ?? {};
  const notifRaw = merged.notifications ?? {};
  const channelsRaw =
    typeof notifRaw.channels === 'object' && notifRaw.channels !== null
      ? (notifRaw.channels as Record<string, unknown>)
      : {};
  const quietRaw =
    typeof notifRaw.quietHours === 'object' && notifRaw.quietHours !== null
      ? (notifRaw.quietHours as Record<string, unknown>)
      : {};

  const tone = isAiTone(aiRaw.tone)
    ? aiRaw.tone
    : GLOBAL_USER_PREFERENCES_DEFAULTS.ai.tone;

  return {
    regional: {
      weekStartsOn:
        storedWeekStartsOn ?? weekStartsOnFromLocale(options.locale),
    },
    ai: {
      tone,
      proactiveInsights:
        typeof aiRaw.proactiveInsights === 'boolean'
          ? aiRaw.proactiveInsights
          : GLOBAL_USER_PREFERENCES_DEFAULTS.ai.proactiveInsights,
      confirmBeforeActions:
        typeof aiRaw.confirmBeforeActions === 'boolean'
          ? aiRaw.confirmBeforeActions
          : GLOBAL_USER_PREFERENCES_DEFAULTS.ai.confirmBeforeActions,
      defaultProvider:
        typeof aiRaw.defaultProvider === 'string'
          ? aiRaw.defaultProvider
          : aiRaw.defaultProvider === null
            ? null
            : GLOBAL_USER_PREFERENCES_DEFAULTS.ai.defaultProvider,
    },
    notifications: {
      channels: {
        push:
          typeof channelsRaw.push === 'boolean'
            ? channelsRaw.push
            : GLOBAL_USER_PREFERENCES_DEFAULTS.notifications.channels.push,
        email:
          typeof channelsRaw.email === 'boolean'
            ? channelsRaw.email
            : GLOBAL_USER_PREFERENCES_DEFAULTS.notifications.channels.email,
        inApp:
          typeof channelsRaw.inApp === 'boolean'
            ? channelsRaw.inApp
            : GLOBAL_USER_PREFERENCES_DEFAULTS.notifications.channels.inApp,
      },
      quietHours: {
        enabled:
          typeof quietRaw.enabled === 'boolean'
            ? quietRaw.enabled
            : GLOBAL_USER_PREFERENCES_DEFAULTS.notifications.quietHours.enabled,
        start:
          typeof quietRaw.start === 'string'
            ? quietRaw.start
            : GLOBAL_USER_PREFERENCES_DEFAULTS.notifications.quietHours.start,
        end:
          typeof quietRaw.end === 'string'
            ? quietRaw.end
            : GLOBAL_USER_PREFERENCES_DEFAULTS.notifications.quietHours.end,
        timezone:
          typeof quietRaw.timezone === 'string'
            ? quietRaw.timezone
            : (options.timezone ??
              GLOBAL_USER_PREFERENCES_DEFAULTS.notifications.quietHours
                .timezone),
      },
    },
  };
}
