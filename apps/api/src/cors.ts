import { isAllowedCorsOrigin } from '@personal-os/config';

type NonProductionCorsOriginInput = {
  allowedOrigins: readonly string[];
  sameServerOrigins: readonly string[];
  originPatterns: readonly RegExp[];
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
 *
 * A rejected origin also answers without CORS headers: reporting it as an
 * error would make the `cors` middleware fail the preflight with a 500.
 */
export function resolveNonProductionCorsOrigin({
  allowedOrigins,
  sameServerOrigins,
  originPatterns,
}: NonProductionCorsOriginInput): CorsOriginResolver {
  const knownOrigins = [...allowedOrigins, ...sameServerOrigins];

  return (origin, callback) => {
    if (!origin) {
      callback(null, false);
      return;
    }

    callback(
      null,
      isAllowedCorsOrigin({
        origin,
        allowedOrigins: knownOrigins,
        originPatterns,
      }),
    );
  };
}
