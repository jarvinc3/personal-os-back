import {
  DEFAULT_WEEK_STARTS_ON,
  WEEK_STARTS_ON_VALUES,
  type WeekStartsOn,
} from './defaults/global-preferences-defaults';

/** ICU `weekInfo.firstDay` numbers Monday as 1 and Sunday as 7. */
const ICU_FIRST_DAY_TO_WEEK_STARTS_ON: Record<
  number,
  WeekStartsOn | undefined
> = {
  1: 1,
  6: 6,
  7: 0,
};

/** `getWeekInfo` is the method-shaped variant some engines expose; the lib types only the getter. */
function readFirstDay(locale: Intl.Locale): number | undefined {
  const withWeekInfo = locale as Intl.Locale & {
    weekInfo?: { firstDay: number };
    getWeekInfo?: () => { firstDay: number };
  };
  return (
    withWeekInfo.weekInfo?.firstDay ?? withWeekInfo.getWeekInfo?.().firstDay
  );
}

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

/**
 * The locale decides the first day when the profile stores `null`. Monday is
 * the answer only when the engine lacks `weekInfo`; a locale whose first day
 * cannot be stored is an unsupported value, not a missing one.
 */
export function weekStartsOnFromLocale(locale: string): WeekStartsOn {
  const parsedLocale = parseLocale(locale);
  const firstDay = readFirstDay(parsedLocale);

  if (firstDay === undefined) {
    return DEFAULT_WEEK_STARTS_ON;
  }

  const weekStartsOn = ICU_FIRST_DAY_TO_WEEK_STARTS_ON[firstDay];
  if (weekStartsOn === undefined) {
    throw new Error(
      `Locale ${locale} starts the week on unsupported day ${firstDay}`,
    );
  }
  return weekStartsOn;
}

function parseLocale(locale: string): Intl.Locale {
  try {
    return new Intl.Locale(locale);
  } catch (error) {
    throw new Error(`Invalid locale on the user profile: ${locale}`, {
      cause: error,
    });
  }
}
