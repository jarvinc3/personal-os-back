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

const DEFAULTS = GLOBAL_USER_PREFERENCES_DEFAULTS;

function isAiTone(value: unknown): value is AiTone {
  return value === 'concise' || value === 'balanced' || value === 'detailed';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/** A stored boolean wins; any other stored type falls back to the default. */
function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
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
  const merged = mergeWithDefaults<Record<string, unknown>>(
    typeof raw === 'object' && raw !== null ? raw : {},
    DEFAULTS,
  );

  const regionalRaw = asRecord(merged.regional);
  const aiRaw = asRecord(merged.ai);
  const notifRaw = asRecord(merged.notifications);
  const channelsRaw = asRecord(notifRaw.channels);
  const quietRaw = asRecord(notifRaw.quietHours);

  const storedWeekStartsOn = readStoredWeekStartsOn(regionalRaw.weekStartsOn);
  const storedProvider = aiRaw.defaultProvider;
  const storedTimezone = quietRaw.timezone;

  return {
    regional: {
      weekStartsOn:
        storedWeekStartsOn ?? weekStartsOnFromLocale(options.locale),
    },
    ai: {
      tone: isAiTone(aiRaw.tone) ? aiRaw.tone : DEFAULTS.ai.tone,
      proactiveInsights: readBoolean(
        aiRaw.proactiveInsights,
        DEFAULTS.ai.proactiveInsights,
      ),
      confirmBeforeActions: readBoolean(
        aiRaw.confirmBeforeActions,
        DEFAULTS.ai.confirmBeforeActions,
      ),
      // A stored null means "use the automatic provider"; any other type is
      // ignored in favor of the default.
      defaultProvider:
        typeof storedProvider === 'string' || storedProvider === null
          ? storedProvider
          : DEFAULTS.ai.defaultProvider,
    },
    notifications: {
      channels: {
        push: readBoolean(
          channelsRaw.push,
          DEFAULTS.notifications.channels.push,
        ),
        email: readBoolean(
          channelsRaw.email,
          DEFAULTS.notifications.channels.email,
        ),
        inApp: readBoolean(
          channelsRaw.inApp,
          DEFAULTS.notifications.channels.inApp,
        ),
      },
      quietHours: {
        enabled: readBoolean(
          quietRaw.enabled,
          DEFAULTS.notifications.quietHours.enabled,
        ),
        start: readString(
          quietRaw.start,
          DEFAULTS.notifications.quietHours.start,
        ),
        end: readString(quietRaw.end, DEFAULTS.notifications.quietHours.end),
        // A stored zone wins; otherwise the request zone, then the default.
        timezone:
          typeof storedTimezone === 'string'
            ? storedTimezone
            : (options.timezone ?? DEFAULTS.notifications.quietHours.timezone),
      },
    },
  };
}
