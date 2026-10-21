/** An IANA name starts with a letter; `+04:00` is a fixed offset, not a zone. */
const IANA_NAME_REGEX = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/;

/**
 * A zone name is valid when the name has IANA shape and the runtime can build a
 * formatter with it. `Intl.supportedValuesOf` is not enough: it keeps old names
 * (`Europe/Kiev`) while browsers report the current ones (`Europe/Kyiv`).
 */
export function isIanaTimeZone(value: string): boolean {
  const zone = value.trim();
  if (!IANA_NAME_REGEX.test(zone)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    // An unknown zone is the answer this predicate exists to give, not a fault.
    return false;
  }
}
