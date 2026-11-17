import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  ExchangeRateFailureCode,
  ExchangeRateResult,
} from './ports/exchange-rate.port';

const PROVIDER_FAILURE_CODES: ReadonlySet<ExchangeRateFailureCode> = new Set([
  'PROVIDER_UNAUTHORIZED',
  'PROVIDER_UNAVAILABLE',
  'API_KEY_MISSING',
  'PROVIDER_ERROR',
]);

type ExchangeRateFailure = Extract<ExchangeRateResult, { ok: false }>;

/**
 * Un fallo del proveedor o de configuración es 503; un 400 solo significa que
 * de verdad no hay tasa exacta ni una anterior publicada.
 */
export function exchangeRateFailureException({
  from,
  to,
  date,
  failure,
}: {
  from: string;
  to: string;
  date: string;
  failure: ExchangeRateFailure;
}): ServiceUnavailableException | BadRequestException {
  if (PROVIDER_FAILURE_CODES.has(failure.code)) {
    return new ServiceUnavailableException(
      `Exchange rate provider unavailable for ${from}->${to} on ${date}: ${failure.message}`,
    );
  }
  return new BadRequestException(
    `Exchange rate unavailable for ${from}->${to} on ${date}: ${failure.message}`,
  );
}
