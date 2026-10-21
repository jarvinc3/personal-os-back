import {
  DEFAULT_WEEK_STARTS_ON,
  WEEK_STARTS_ON_VALUES,
  type WeekStartsOn,
} from './defaults/global-preferences-defaults';

/**
 * ICU `weekInfo.firstDay` numbers Monday as 1 and Sunday as 7. Mid-week starts
 * (2-5) cannot be stored, so they fall back to Monday.
 */
const ICU_FIRST_DAY_TO_WEEK_STARTS_ON: Record<
  number,
  WeekStartsOn | undefined
> = {
  1: 1,
  6: 6,
  7: 0,
};

/**
 * Last resort for engines without `Intl.Locale.weekInfo`. Covers the locales
 * the product ships.
 */
const WEEK_STARTS_ON_BY_LOCALE: Record<string, WeekStartsOn | undefined> = {
  'es-do': 0,
  'en-us': 0,
  'es-es': 1,
};

/**
 * `Intl.Locale` throws on malformed tags and stored locales predate any
 * validation, so only the simple language[-region] shape reaches it.
 */
const SIMPLE_LOCALE_TAG = /^[a-z]{2,3}(-[a-z]{2}|-[0-9]{3})?$/i;

export function isWeekStartsOn(value: unknown): value is WeekStartsOn {
  return WEEK_STARTS_ON_VALUES.includes(value as WeekStartsOn);
}

export function validateWeekStartsOn(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isWeekStartsOn(value)) {
    return 'regional.weekStartsOn must be 0 (Sunday), 1 (Monday), 6 (Saturday) or null';
  }
  return null;
}

/** Reads the raw stored value from an update payload without assuming its shape. */
export function readWeekStartsOnInput(preferences: unknown): unknown {
  if (typeof preferences !== 'object' || preferences === null) {
    return undefined;
  }
  const regional = (preferences as { regional?: unknown }).regional;
  if (typeof regional !== 'object' || regional === null) {
    return undefined;
  }
  return (regional as { weekStartsOn?: unknown }).weekStartsOn;
}

export function weekStartsOnFromLocale(locale?: string | null): WeekStartsOn {
  const normalizedLocale = locale?.trim().toLowerCase();
  if (!normalizedLocale) {
    return DEFAULT_WEEK_STARTS_ON;
  }

  if (!SIMPLE_LOCALE_TAG.test(normalizedLocale)) {
    return WEEK_STARTS_ON_BY_LOCALE[normalizedLocale] ?? DEFAULT_WEEK_STARTS_ON;
  }

  const icuFirstDay = readIcuFirstDay(normalizedLocale);
  if (icuFirstDay === undefined) {
    return WEEK_STARTS_ON_BY_LOCALE[normalizedLocale] ?? DEFAULT_WEEK_STARTS_ON;
  }

  return ICU_FIRST_DAY_TO_WEEK_STARTS_ON[icuFirstDay] ?? DEFAULT_WEEK_STARTS_ON;
}

function readIcuFirstDay(locale: string): number | undefined {
  const localeWithWeekInfo = new Intl.Locale(locale) as Intl.Locale & {
    weekInfo?: { firstDay: number };
    getWeekInfo?: () => { firstDay: number };
  };

  return (
    localeWithWeekInfo.weekInfo?.firstDay ??
    localeWithWeekInfo.getWeekInfo?.().firstDay
  );
}
