export const GLOBAL_USER_PREFERENCES_DEFAULTS = {
  version: 1,
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
