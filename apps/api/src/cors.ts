type NonProductionCorsOriginInput = {
  allowedOrigins: readonly string[];
  sameServerOrigins: readonly string[];
};

export type CorsOriginCallback = (
  error: Error | null,
  allowed: boolean,
) => void;

export type CorsOriginResolver = (
  origin: string | undefined,
  callback: CorsOriginCallback,
) => void;

/**
 * Non-production CORS. A request without `Origin` is not a browser
 * cross-origin call (direct navigation to Swagger, favicon, curl), so it
 * passes without CORS headers instead of failing.
 */
export function resolveNonProductionCorsOrigin({
  allowedOrigins,
  sameServerOrigins,
}: NonProductionCorsOriginInput): CorsOriginResolver {
  return (origin, callback) => {
    if (!origin) {
      callback(null, false);
      return;
    }

    const isAllowed =
      allowedOrigins.includes(origin) ||
      allowedOrigins.includes('*') ||
      sameServerOrigins.includes(origin);

    if (!isAllowed) {
      callback(new Error(`Origin ${origin} not allowed by CORS`), false);
      return;
    }

    callback(null, true);
  };
}
