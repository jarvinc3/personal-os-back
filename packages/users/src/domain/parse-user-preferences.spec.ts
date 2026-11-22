import { parseUserPreferences } from './parse-user-preferences';

describe('parseUserPreferences regional', () => {
  it('resolves the week start from the locale when nothing is stored', () => {
    const sunday = parseUserPreferences({}, { locale: 'es-DO' });
    expect(sunday.regional.weekStartsOn).toBe(0);

    const monday = parseUserPreferences({}, { locale: 'es-ES' });
    expect(monday.regional.weekStartsOn).toBe(1);
  });

  it('keeps a stored choice over the locale', () => {
    const prefs = parseUserPreferences(
      { regional: { weekStartsOn: 6 } },
      { locale: 'es-DO' },
    );
    expect(prefs.regional.weekStartsOn).toBe(6);
  });

  it('keeps the automatic null and resolves it from the locale', () => {
    const prefs = parseUserPreferences(
      { regional: { weekStartsOn: null } },
      { locale: 'en-US' },
    );
    expect(prefs.regional.weekStartsOn).toBe(0);
  });

  it('rejects an invalid stored value instead of guessing', () => {
    expect(() =>
      parseUserPreferences(
        { regional: { weekStartsOn: 3 } },
        { locale: 'es-ES' },
      ),
    ).toThrow(/Invalid regional.weekStartsOn/);
  });

  it('keeps the rest of the preferences untouched', () => {
    const prefs = parseUserPreferences(
      {
        ai: { tone: 'concise' },
        notifications: { channels: { email: true } },
      },
      { timezone: 'Europe/Madrid', locale: 'es-ES' },
    );

    expect(prefs.ai.tone).toBe('concise');
    expect(prefs.notifications.channels.email).toBe(true);
    expect(prefs.notifications.quietHours.timezone).toBe('Europe/Madrid');
  });
});

describe('parseUserPreferences stored values', () => {
  const options = { locale: 'es-DO', timezone: 'America/Santo_Domingo' };

  it('falls back to the defaults for a stored value of the wrong type', () => {
    const prefs = parseUserPreferences(
      {
        ai: { proactiveInsights: 'yes', confirmBeforeActions: 1 },
        notifications: { channels: { push: 'true', email: null, inApp: 0 } },
      },
      options,
    );

    expect(prefs.ai.proactiveInsights).toBe(true);
    expect(prefs.ai.confirmBeforeActions).toBe(true);
    expect(prefs.notifications.channels).toEqual({
      push: true,
      email: false,
      inApp: true,
    });
  });

  it('keeps a stored provider and an explicit null', () => {
    expect(
      parseUserPreferences({ ai: { defaultProvider: 'groq' } }, options).ai
        .defaultProvider,
    ).toBe('groq');
    expect(
      parseUserPreferences({ ai: { defaultProvider: null } }, options).ai
        .defaultProvider,
    ).toBeNull();
    expect(
      parseUserPreferences({ ai: { defaultProvider: 42 } }, options).ai
        .defaultProvider,
    ).toBeNull();
  });

  it('prefers the stored quiet-hours zone over the request zone', () => {
    expect(
      parseUserPreferences(
        { notifications: { quietHours: { timezone: 'Europe/Madrid' } } },
        options,
      ).notifications.quietHours.timezone,
    ).toBe('Europe/Madrid');
    expect(
      parseUserPreferences({}, options).notifications.quietHours.timezone,
    ).toBe('America/Santo_Domingo');
    expect(
      parseUserPreferences(
        { notifications: { quietHours: { timezone: null } } },
        options,
      ).notifications.quietHours.timezone,
    ).toBe('America/Santo_Domingo');
  });
});
