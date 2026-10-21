/**
 * First day of the week using `Date.getDay()`: 0 Sunday, 1 Monday, 6 Saturday.
 * Only these three are valid, because the product exposes just those.
 */
export const WEEK_STARTS_ON_VALUES = [0, 1, 6] as const;

export type WeekStartsOn = (typeof WEEK_STARTS_ON_VALUES)[number];

export const DEFAULT_WEEK_STARTS_ON: WeekStartsOn = 1;

export const GLOBAL_USER_PREFERENCES_DEFAULTS = {
  version: 1,
  regional: {
    /** `null` resolves from the user locale instead of a stored choice. */
    weekStartsOn: null as WeekStartsOn | null,
  },
  ai: {
    tone: 'balanced' as const,
    proactiveInsights: true,
    confirmBeforeActions: true,
    defaultProvider: null as string | null,
  },
  notifications: {
    channels: {
      push: true,
      email: false,
      inApp: true,
    },
    quietHours: {
      enabled: false,
      start: '22:00',
      end: '08:00',
      timezone: null as string | null,
    },
  },
} as const;

export type AiTone = 'concise' | 'balanced' | 'detailed';

export type ParsedUserPreferences = {
  regional: {
    weekStartsOn: WeekStartsOn;
  };
  ai: {
    tone: AiTone;
    proactiveInsights: boolean;
    confirmBeforeActions: boolean;
    defaultProvider: string | null;
  };
  notifications: {
    channels: { push: boolean; email: boolean; inApp: boolean };
    quietHours: {
      enabled: boolean;
      start: string;
      end: string;
      timezone: string | null;
    };
  };
};
