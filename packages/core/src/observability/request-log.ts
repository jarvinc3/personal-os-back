/** Request timed by `LoggingInterceptor` so failures report their duration. */
export type TimedRequest = { startedAt?: number };

/**
 * Milliseconds from the interceptor's start to `now`. `undefined` when the
 * failure happened before it ran: a guard or a middleware rejected the request.
 */
export function requestDurationMs(
  request: TimedRequest,
  now: number,
): number | undefined {
  const { startedAt } = request;
  return startedAt === undefined ? undefined : now - startedAt;
}

export type LoggableRequest = {
  baseUrl?: string;
  route?: { path?: string | string[] };
  url?: string;
  originalUrl?: string;
  params?: Record<string, unknown>;
};

/**
 * Returns the matched route template so path parameters never reach the logs.
 * Unmatched requests fall back to the path without the query string.
 */
export function requestLogPath(request: LoggableRequest): string {
  const routePath = request.route?.path;
  if (typeof routePath === 'string' && routePath.length > 0) {
    return `${request.baseUrl ?? ''}${routePath}`;
  }
  const rawPath = (request.originalUrl ?? request.url ?? '').split('?')[0];
  return maskPathParams(rawPath, request.params);
}

/**
 * Fallback for requests without a matched route: replaces known param values
 * with their names so a credential in the path does not survive.
 */
function maskPathParams(
  path: string,
  params: Record<string, unknown> | undefined,
): string {
  if (!params) {
    return path;
  }
  const namesByValue = new Map<string, string>();
  for (const [name, value] of Object.entries(params)) {
    if (typeof value !== 'string' || value.length === 0) {
      continue;
    }
    namesByValue.set(value, name);
    namesByValue.set(encodeURIComponent(value), name);
  }
  return path
    .split('/')
    .map((segment) => {
      const name = namesByValue.get(segment);
      return name ? `:${name}` : segment;
    })
    .join('/');
}
