/**
 * A locale stored on the profile must be a tag `Intl` can parse, because date
 * and number formatting on the clients construct `Intl` objects from it.
 */
export function isLocaleTag(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    return false;
  }
  try {
    Intl.getCanonicalLocales(value);
    return true;
  } catch {
    return false;
  }
}
