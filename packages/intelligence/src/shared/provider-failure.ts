import { getProviderHttpStatus } from './is-retryable-provider-error';

export const PROVIDER_FAILURE_PREFIX = 'PROVIDER_FAILURE';
export const MAX_PROVIDER_MESSAGE_LENGTH = 200;

export type ProviderFailureCause =
  'rate_limit' | 'quota' | 'auth' | 'server' | 'network' | 'unknown';

export type ProviderFailureLogDetails = {
  provider: string;
  model: string;
  httpStatus: number | null;
  retryable: boolean;
  fallback: boolean;
  cause: ProviderFailureCause;
  message: string | null;
};

const NETWORK_ERROR_CODES = new Set([
  'EAI_AGAIN',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);
const NETWORK_MESSAGE_PATTERN =
  /network|fetch failed|socket|timed? ?out|timeout|econn|enotfound|eai_again|epipe|abort/i;
const RATE_LIMIT_MESSAGE_PATTERN =
  /rate limit|too many requests|requests per (?:minute|day)|try again in/i;
const QUOTA_MESSAGE_PATTERN =
  /quota|insufficient (?:credits|balance|funds)|payment required|billing/i;
const AUTH_MESSAGE_PATTERN =
  /unauthorized|forbidden|invalid api key|authentication|api key/i;
const SERVER_MESSAGE_PATTERN =
  /overloaded|capacity|service unavailable|internal server|bad gateway|gateway timeout/i;

const MAX_RAW_MESSAGE_LENGTH = MAX_PROVIDER_MESSAGE_LENGTH * 4;

export function getProviderFailureCause(
  error: unknown,
  httpStatus: number | null = getProviderHttpStatus(error),
): ProviderFailureCause {
  if (httpStatus !== null) {
    return causeFromHttpStatus(httpStatus);
  }
  const errorCode = getErrorCode(error);
  if (errorCode && NETWORK_ERROR_CODES.has(errorCode.toUpperCase())) {
    return 'network';
  }
  const message = errorMessage(error);
  if (!message) {
    return 'unknown';
  }
  if (NETWORK_MESSAGE_PATTERN.test(message)) {
    return 'network';
  }
  if (RATE_LIMIT_MESSAGE_PATTERN.test(message)) {
    return 'rate_limit';
  }
  if (QUOTA_MESSAGE_PATTERN.test(message)) {
    return 'quota';
  }
  if (AUTH_MESSAGE_PATTERN.test(message)) {
    return 'auth';
  }
  if (SERVER_MESSAGE_PATTERN.test(message)) {
    return 'server';
  }
  return 'unknown';
}

export function buildProviderFailureEvidenceCode({
  cause,
  httpStatus,
  retryable,
}: {
  cause: ProviderFailureCause;
  httpStatus: number | null;
  retryable: boolean;
}): string {
  return [
    PROVIDER_FAILURE_PREFIX,
    `cause=${cause}`,
    `status=${httpStatus ?? 'none'}`,
    `retryable=${retryable}`,
  ].join(':');
}

export function buildProviderFailureLogDetails({
  error,
  provider,
  model,
  retryable,
  fallback,
}: {
  error: unknown;
  provider: string;
  model: string;
  retryable: boolean;
  fallback: boolean;
}): ProviderFailureLogDetails {
  const httpStatus = getProviderHttpStatus(error);
  return {
    provider,
    model,
    httpStatus,
    retryable,
    fallback,
    cause: getProviderFailureCause(error, httpStatus),
    message: sanitizeProviderErrorMessage(error),
  };
}

export function providerFailureLogMessage(
  details: ProviderFailureLogDetails,
): string {
  return `AI provider failure ${JSON.stringify(details)}`;
}

export function sanitizeProviderErrorMessage(error: unknown): string | null {
  const raw = errorMessage(error);
  if (!raw) {
    return null;
  }
  const bounded = raw.slice(0, MAX_RAW_MESSAGE_LENGTH).replace(/\s+/g, ' ');
  const bodyIndex = bounded.search(/[<{]/);
  const withoutBody =
    bodyIndex >= 0
      ? `${bounded.slice(0, bodyIndex).trim()} [body omitted]`
      : bounded;
  const sanitized = withoutBody
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\bauthorization\b"?\s*[:=][\s\S]*$/gi, 'authorization=[redacted]')
    .replace(
      /("?(?:api[_-]?key|key|x-api-key|access[_-]?token|refresh[_-]?token|secret|password|token)"?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1[redacted]',
    )
    .replace(/\b(?:sk|gsk|sk-or-v1)[-_][A-Za-z0-9_-]{8,}\b/gi, '[redacted-key]')
    .replace(/\/\/[^/\s:@]+:[^/\s@]+@/g, '//[redacted]@');
  return sanitized.slice(0, MAX_PROVIDER_MESSAGE_LENGTH).trim();
}

function causeFromHttpStatus(status: number): ProviderFailureCause {
  if (status === 401 || status === 403) {
    return 'auth';
  }
  if (status === 402) {
    return 'quota';
  }
  if (status === 408) {
    return 'network';
  }
  if (status === 429) {
    return 'rate_limit';
  }
  if (status >= 500) {
    return 'server';
  }
  return 'unknown';
}

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const candidate = error as {
    code?: unknown;
    errno?: unknown;
    cause?: unknown;
    error?: unknown;
  };
  const values = [
    candidate.code,
    candidate.errno,
    nestedCode(candidate.cause),
    nestedCode(candidate.error),
  ];
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

function nestedCode(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return (value as { code?: unknown }).code;
}

function errorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    return error.trim();
  }
  return null;
}
