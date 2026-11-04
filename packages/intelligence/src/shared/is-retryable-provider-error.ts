const RETRYABLE_HTTP_STATUS = new Set([402, 404, 429, 500, 502, 503, 529]);

export function getProviderHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
  };
  const statuses = [
    candidate.status,
    candidate.statusCode,
    candidate.response?.status,
  ];
  return (
    statuses.find(
      (status): status is number =>
        typeof status === 'number' &&
        Number.isInteger(status) &&
        status >= 100 &&
        status <= 599,
    ) ?? null
  );
}

export function isRetryableProviderError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const status = getProviderHttpStatus(error);
  if (typeof status === 'number' && RETRYABLE_HTTP_STATUS.has(status)) {
    return true;
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Provider error';
  return /rate limit|quota|overloaded|capacity|too many requests|model_not_found|does not exist|input validation failed|tools should have a name/i.test(
    message,
  );
}
