/**
 * Parses env-style booleans. Only accepts true/false/1/0 (case-insensitive).
 * Empty / unset returns undefined (caller decides default).
 * Invalid non-empty values throw so Zod/startup fails fast.
 */
export function parseStrictEnvBoolean(
  value: unknown,
  fieldName = 'value',
): boolean | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return booleanFromNumber(value, fieldName);
  }
  if (typeof value === 'string') {
    return booleanFromString(value, fieldName);
  }
  throw new Error(
    `${fieldName} must be true/false/1/0, received ${typeof value}`,
  );
}

function booleanFromNumber(value: number, fieldName: string): boolean {
  if (value === 1) {
    return true;
  }
  if (value === 0) {
    return false;
  }
  throw new Error(
    `${fieldName} must be true/false/1/0, received number ${value}`,
  );
}

function booleanFromString(value: string, fieldName: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }
  throw new Error(`${fieldName} must be true/false/1/0, received "${value}"`);
}
