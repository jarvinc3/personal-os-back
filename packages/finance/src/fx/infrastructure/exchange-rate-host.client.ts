import type { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { Env } from '@personal-os/config';

const historicalSchema = z.object({
  success: z.boolean().optional(),
  rates: z.record(z.string(), z.number()).optional(),
  quotes: z.record(z.string(), z.number()).optional(),
  error: z
    .object({
      info: z.string().optional(),
      code: z.union([z.string(), z.number()]).optional(),
    })
    .optional(),
});

const currencyListSchema = z.object({
  success: z.boolean().optional(),
  currencies: z.record(z.string(), z.string()).optional(),
  symbols: z.record(z.string(), z.string()).optional(),
});

export type FxProviderFailureKind =
  'auth' | 'transient' | 'no_rate' | 'provider' | 'shape';

export class FxProviderError extends Error {
  constructor(
    message: string,
    readonly providerStatus: number | null,
    readonly kind: FxProviderFailureKind,
  ) {
    super(message);
    this.name = 'FxProviderError';
  }
}

function statusFailureKind(status: number): FxProviderFailureKind {
  if (status === 401 || status === 403) {
    return 'auth';
  }
  if (status === 429 || status >= 500) {
    return 'transient';
  }
  return 'provider';
}

function messageFailureKind(message: string): FxProviderFailureKind {
  if (/access key|unauthori[sz]ed|invalid key|forbidden/i.test(message)) {
    return 'auth';
  }
  if (/quota|rate limit|too many|limit exceeded|usage limit/i.test(message)) {
    return 'transient';
  }
  if (/no data|no result|no rate/i.test(message)) {
    return 'no_rate';
  }
  return 'provider';
}

/** HTTP client of the FX provider: requests, parsing and its own error type. */
export class ExchangeRateHostClient {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly logger: Logger,
  ) {}

  async fetchCurrencyCodes(): Promise<string[]> {
    const apiKey = this.config.get('EXCHANGE_RATE_HOST_API_KEY', {
      infer: true,
    });
    if (!apiKey) {
      return [];
    }

    try {
      const url = new URL('https://api.exchangerate.host/list');
      url.searchParams.set('access_key', apiKey);
      const response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const json: unknown = await response.json();
      const parsed = currencyListSchema.safeParse(json);
      if (!parsed.success) {
        throw new Error('Unexpected FX list response shape');
      }

      const named = parsed.data.currencies ?? parsed.data.symbols ?? {};
      return Object.keys(named)
        .map((code) => code.toUpperCase())
        .filter((code) => /^[A-Z]{3}$/.test(code));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`FX currency list failed: ${message}`);
      return [];
    }
  }

  async fetchRate({
    from,
    to,
    date,
    accessKey,
  }: {
    from: string;
    to: string;
    date: string;
    accessKey: string;
  }): Promise<number> {
    // Historical endpoint (APILayer exchangerate.host)
    const url = new URL(`https://api.exchangerate.host/historical`);
    url.searchParams.set('access_key', accessKey);
    url.searchParams.set('date', date);
    url.searchParams.set('source', from);
    url.searchParams.set('currencies', to);

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new FxProviderError(
        `HTTP ${response.status}`,
        response.status,
        statusFailureKind(response.status),
      );
    }

    const json: unknown = await response.json();
    return historicalRate({ json, from, to });
  }
}

function historicalRate({
  json,
  from,
  to,
}: {
  json: unknown;
  from: string;
  to: string;
}): number {
  const parsed = historicalSchema.safeParse(json);
  if (!parsed.success) {
    throw new FxProviderError('Unexpected FX response shape', null, 'shape');
  }
  if (parsed.data.success === false) {
    const providerMessage =
      parsed.data.error?.info ?? 'FX provider rejected request';
    throw new FxProviderError(
      providerMessage,
      null,
      messageFailureKind(providerMessage),
    );
  }
  return quoteRate({
    quotes: parsed.data.quotes,
    rates: parsed.data.rates,
    from,
    to,
  });
}

function quoteRate({
  quotes,
  rates,
  from,
  to,
}: {
  quotes: Record<string, number> | undefined;
  rates: Record<string, number> | undefined;
  from: string;
  to: string;
}): number {
  const rate = quotes?.[`${from}${to}`] ?? quotes?.[to] ?? rates?.[to];
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
    throw new FxProviderError(`Missing rate for ${to}`, null, 'no_rate');
  }
  return rate;
}
