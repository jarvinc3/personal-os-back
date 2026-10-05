const HTTP_EXCEPTION_RESERVED_KEYS = new Set([
  'statusCode',
  'error',
  'message',
]);

export function httpExceptionDetails(
  payload: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const details: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!HTTP_EXCEPTION_RESERVED_KEYS.has(key)) {
      details[key] = value;
    }
  }
  return Object.keys(details).length > 0 ? details : undefined;
}

export function toErrorField(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (value instanceof Error) {
    return value.message;
  }

  if (Array.isArray(value)) {
    const parts = value.filter((item): item is string => typeof item === 'string');
    if (parts.length > 0) {
      return parts.join('; ');
    }
  }

  return fallback;
}
