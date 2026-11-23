import {
  isAllowedCorsOrigin,
  parseCorsOriginPatterns,
} from '@personal-os/config';

const CORS_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const CORS_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'x-request-id',
  'Idempotency-Key',
  'Accept',
];

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

export type CorsConfiguration = {
  origin: string | string[] | CorsOriginResolver;
  methods: string[];
  allowedHeaders: string[];
  credentials: boolean;
};

type CorsConfigurationInput = {
  isProduction: boolean;
  corsOrigin: string;
  corsOriginPatterns: string;
  port: number;
};

export function buildCorsConfiguration({
  isProduction,
  corsOrigin,
  corsOriginPatterns,
  port,
}: CorsConfigurationInput): CorsConfiguration {
  if (isProduction && corsOrigin === '*') {
    throw new Error(
      'In production CORS_ORIGIN must be set to the exact frontend origin.',
    );
  }

  const allowedOrigins = parseCorsOrigins(corsOrigin);
  return {
    origin: resolveCorsOrigin({
      isProduction,
      allowedOrigins,
      corsOriginPatterns,
      port,
    }),
    methods: CORS_METHODS,
    allowedHeaders: CORS_ALLOWED_HEADERS,
    credentials: true,
  };
}

export function parseCorsOrigins(corsOrigin: string): string[] {
  return corsOrigin
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

type ResolveCorsOriginInput = {
  isProduction: boolean;
  allowedOrigins: readonly string[];
  corsOriginPatterns: string;
  port: number;
};

function resolveCorsOrigin({
  isProduction,
  allowedOrigins,
  corsOriginPatterns,
  port,
}: ResolveCorsOriginInput): string | string[] | CorsOriginResolver {
  if (isProduction) {
    return allowedOrigins.length === 1
      ? allowedOrigins[0]
      : [...allowedOrigins];
  }

  // Bull Board (same host) sends Origin on PUT/DELETE; allow the API's own origin in non-prod.
  const sameServerOrigins = [
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ];

  return resolveNonProductionCorsOrigin({
    allowedOrigins,
    sameServerOrigins,
    originPatterns: parseCorsOriginPatterns(corsOriginPatterns),
  });
}

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
