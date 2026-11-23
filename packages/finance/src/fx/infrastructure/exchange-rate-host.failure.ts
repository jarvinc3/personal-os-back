import type { ExchangeRateResult } from '../application/ports/exchange-rate.port';
import {
  FxProviderError,
  type FxProviderFailureKind,
} from './exchange-rate-host.client';

type ProviderFailureReport = {
  result: ExchangeRateResult;
  logMessage: string | null;
};

type FailureContext = {
  from: string;
  to: string;
  date: string;
  message: string;
  statusText: string;
  detail: string;
  providerStatus: number | undefined;
};

/** Maps a provider exception to the port result and the log line it needs. */
export function mapProviderFailure({
  from,
  to,
  date,
  error,
}: {
  from: string;
  to: string;
  date: string;
  error: unknown;
}): ProviderFailureReport {
  const message = error instanceof Error ? error.message : String(error);
  const providerStatus = providerStatusOf(error);
  const kind = failureKindOf(error);
  const context = {
    from,
    to,
    date,
    message,
    statusText: statusText(providerStatus),
    detail: detailText(message, providerStatus),
    providerStatus,
  };
  return {
    result: failureResult({ kind, context }),
    logMessage: failureLog(kind, context),
  };
}

function providerStatusOf(error: unknown): number | undefined {
  return error instanceof FxProviderError
    ? (error.providerStatus ?? undefined)
    : undefined;
}

function failureKindOf(error: unknown): FxProviderFailureKind {
  return error instanceof FxProviderError ? error.kind : 'transient';
}

function failureLog(
  kind: FxProviderFailureKind,
  { from, to, date, message }: FailureContext,
): string | null {
  if (kind === 'no_rate') {
    return null;
  }
  return `FX API failed for ${from}->${to} on ${date}: ${message}`;
}

function statusText(providerStatus: number | undefined): string {
  return providerStatus ? ` (HTTP ${providerStatus})` : '';
}

function detailText(
  message: string,
  providerStatus: number | undefined,
): string {
  return message === (providerStatus ? `HTTP ${providerStatus}` : '')
    ? ''
    : `: ${message}`;
}

function failureResult({
  kind,
  context,
}: {
  kind: FxProviderFailureKind;
  context: FailureContext;
}): ExchangeRateResult {
  const { from, to, date, message, statusText, detail, providerStatus } =
    context;
  if (kind === 'auth') {
    return {
      ok: false,
      code: 'PROVIDER_UNAUTHORIZED',
      message: `FX provider unauthorized${statusText} for ${from}->${to} on ${date}${detail}`,
      retryable: false,
      providerStatus,
    };
  }
  if (kind === 'no_rate') {
    return {
      ok: false,
      code: 'NO_EXACT_RATE',
      message: `No rate for ${from}->${to} on ${date}`,
      retryable: false,
      providerStatus,
    };
  }
  if (kind === 'provider') {
    return {
      ok: false,
      code: 'PROVIDER_ERROR',
      message: `FX provider rejected the request${statusText} for ${from}->${to} on ${date}${detail}`,
      retryable: false,
      providerStatus,
    };
  }
  if (kind === 'shape') {
    return {
      ok: false,
      code: 'PROVIDER_ERROR',
      message: `FX provider returned an unexpected response for ${from}->${to} on ${date}: ${message}`,
      retryable: true,
      providerStatus,
    };
  }
  return {
    ok: false,
    code: 'PROVIDER_UNAVAILABLE',
    message: `FX provider unavailable${statusText} for ${from}->${to} on ${date}${detail}`,
    retryable: true,
    providerStatus,
  };
}
