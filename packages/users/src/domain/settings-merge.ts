function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEmptyObject(value: unknown): boolean {
  return isPlainObject(value) && Object.keys(value).length === 0;
}

export function mergeWithDefaults<T extends Record<string, unknown>>(
  partial: unknown,
  defaults: T,
): T {
  if (partial === null || partial === undefined || isEmptyObject(partial)) {
    return structuredClone(defaults);
  }
  if (!isPlainObject(partial)) {
    return structuredClone(defaults);
  }

  const result = structuredClone(defaults) as Record<string, unknown>;

  for (const key of Object.keys(partial)) {
    const sourceValue = partial[key];
    if (sourceValue === undefined) {
      continue;
    }

    const defaultValue = result[key];

    if (isPlainObject(sourceValue) && isPlainObject(defaultValue)) {
      result[key] = mergeWithDefaults(sourceValue, defaultValue);
    } else {
      result[key] = sourceValue;
    }
  }

  return result as T;
}
