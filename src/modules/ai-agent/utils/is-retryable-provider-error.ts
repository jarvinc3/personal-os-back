const RETRYABLE_HTTP_STATUS = new Set([402, 404, 429, 500, 502, 503, 529]);

export function isRetryableProviderError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const status = (error as { status?: number }).status;
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
