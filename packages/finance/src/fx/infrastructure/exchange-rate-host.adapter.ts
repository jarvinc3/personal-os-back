import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { Env } from '@personal-os/config';
import { PrismaService } from '@personal-os/database';
import { normalizeCurrencyCode } from '../../shared/domain/money';
import type {
  ExchangeRatePort,
  ExchangeRateResult,
} from '../application/ports/exchange-rate.port';

const FALLBACK_CURRENCIES = [
  'DOP',
  'USD',
  'EUR',
  'GBP',
  'CAD',
  'MXN',
  'COP',
  'BRL',
  'CLP',
  'ARS',
] as const;

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

type FxProviderFailureKind =
  'auth' | 'transient' | 'no_rate' | 'provider' | 'shape';

/** Un feriado largo puede dejar varios días sin publicación. */
const LAST_PUBLISHED_LOOKBACK_DAYS = 14;

class FxProviderError extends Error {
  constructor(
    message: string,
    readonly providerStatus: number | null,
    readonly kind: FxProviderFailureKind,
  ) {
    super(message);
    this.name = 'FxProviderError';
  }
}

@Injectable()
export class ExchangeRateHostAdapter implements ExchangeRatePort {
  private readonly logger = new Logger(ExchangeRateHostAdapter.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {}

  async listCurrencies(): Promise<string[]> {
    const codes = new Set<string>(['DOP']);
    const rows = await this.prisma.finExchangeRate.findMany({
      select: { fromCurrency: true, toCurrency: true },
    });
    for (const row of rows) {
      codes.add(row.fromCurrency);
      codes.add(row.toCurrency);
    }

    for (const code of await this.fetchCurrencyCodes()) {
      codes.add(code);
    }

    if (codes.size <= 1) {
      for (const code of FALLBACK_CURRENCIES) {
        codes.add(code);
      }
    }

    return [...codes].sort();
  }

  async getHistoricalRate(params: {
    from: string;
    to: string;
    date: string;
  }): Promise<ExchangeRateResult> {
    const from = normalizeCurrencyCode(params.from);
    const to = normalizeCurrencyCode(params.to);
    if (from === to) {
      return { ok: true, rate: 1, source: 'identity', rateDate: params.date };
    }

    const cached = await this.prisma.finExchangeRate.findUnique({
      where: {
        fromCurrency_toCurrency_rateDate: {
          fromCurrency: from,
          toCurrency: to,
          rateDate: new Date(params.date),
        },
      },
    });
    if (cached) {
      return {
        ok: true,
        rate: Number(cached.rate),
        source: 'cache',
        rateDate: params.date,
      };
    }

    const apiKey = this.config.get('EXCHANGE_RATE_HOST_API_KEY', {
      infer: true,
    });
    if (!apiKey) {
      return {
        ok: false,
        code: 'API_KEY_MISSING',
        message:
          'EXCHANGE_RATE_HOST_API_KEY is not configured and no cached rate exists',
        retryable: false,
      };
    }

    try {
      const rate = await this.fetchFromApi(from, to, params.date, apiKey);
      await this.prisma.finExchangeRate.upsert({
        where: {
          fromCurrency_toCurrency_rateDate: {
            fromCurrency: from,
            toCurrency: to,
            rateDate: new Date(params.date),
          },
        },
        create: {
          fromCurrency: from,
          toCurrency: to,
          rateDate: new Date(params.date),
          rate,
        },
        update: { rate },
      });
      return { ok: true, rate, source: 'api', rateDate: params.date };
    } catch (error) {
      return this.providerFailure({
        from,
        to,
        date: params.date,
        error,
      });
    }
  }

  async getLedgerRate(params: {
    from: string;
    to: string;
    date: string;
  }): Promise<ExchangeRateResult> {
    const exact = await this.getHistoricalRate(params);
    if (exact.ok) {
      return exact;
    }
    if (exact.code !== 'NO_EXACT_RATE') {
      return exact;
    }
    return this.getLastPublishedRateOnOrBefore(params);
  }

  /**
   * Busca la última publicación real hacia atrás. La caché sola no basta: en
   * el primer uso, o con una caché incompleta, el proveedor puede tener una
   * fecha más nueva que la fila guardada. Solo continúa ante una ausencia
   * confirmada; un 401, cuota agotada o error de red detiene la búsqueda.
   */
  private async getLastPublishedRateOnOrBefore(params: {
    from: string;
    to: string;
    date: string;
  }): Promise<ExchangeRateResult> {
    const requested = new Date(`${params.date}T00:00:00.000Z`);
    for (
      let daysBack = 1;
      daysBack <= LAST_PUBLISHED_LOOKBACK_DAYS;
      daysBack += 1
    ) {
      const previousDate = new Date(
        requested.getTime() - daysBack * 24 * 60 * 60 * 1000,
      )
        .toISOString()
        .slice(0, 10);
      const previous = await this.getHistoricalRate({
        from: params.from,
        to: params.to,
        date: previousDate,
      });
      if (previous.ok) {
        return {
          ...previous,
          source: 'cache_last_published',
          rateDate: previous.rateDate ?? previousDate,
        };
      }
      if (previous.code !== 'NO_EXACT_RATE') {
        return previous;
      }
    }
    return {
      ok: false,
      code: 'NO_EXACT_RATE',
      message: `No rate for ${params.from}->${params.to} on or before ${params.date}`,
      retryable: false,
    };
  }

  private providerFailure({
    from,
    to,
    date,
    error,
  }: {
    from: string;
    to: string;
    date: string;
    error: unknown;
  }): ExchangeRateResult {
    const message = error instanceof Error ? error.message : String(error);
    const providerStatus =
      error instanceof FxProviderError
        ? (error.providerStatus ?? undefined)
        : undefined;
    const kind = error instanceof FxProviderError ? error.kind : 'transient';
    if (kind !== 'no_rate') {
      this.logger.warn(
        `FX API failed for ${from}->${to} on ${date}: ${message}`,
      );
    }

    if (kind === 'auth') {
      return {
        ok: false,
        code: 'PROVIDER_UNAUTHORIZED',
        message: `FX provider unauthorized (HTTP ${providerStatus ?? 'unknown'}) for ${from}->${to} on ${date}`,
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
        message: `FX provider rejected the request (HTTP ${providerStatus ?? 'unknown'}) for ${from}->${to} on ${date}: ${message}`,
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
      message: `FX provider unavailable (${message}) for ${from}->${to} on ${date}`,
      retryable: true,
      providerStatus,
    };
  }

  async getLatestRateOnOrBefore(params: {
    from: string;
    to: string;
    date: string;
  }): Promise<ExchangeRateResult> {
    const from = normalizeCurrencyCode(params.from);
    const to = normalizeCurrencyCode(params.to);
    if (from === to) {
      return { ok: true, rate: 1, source: 'identity', rateDate: params.date };
    }

    const cached = await this.prisma.finExchangeRate.findFirst({
      where: {
        fromCurrency: from,
        toCurrency: to,
        rateDate: { lte: new Date(params.date) },
      },
      orderBy: { rateDate: 'desc' },
    });
    if (cached) {
      return {
        ok: true,
        rate: Number(cached.rate),
        source: 'cache',
        rateDate: cached.rateDate.toISOString().slice(0, 10),
      };
    }

    return {
      ok: false,
      code: 'NO_EXACT_RATE',
      message: `No rate for ${from}->${to} on or before ${params.date}`,
      retryable: false,
    };
  }

  private async fetchCurrencyCodes(): Promise<string[]> {
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

  private async fetchFromApi(
    from: string,
    to: string,
    date: string,
    accessKey: string,
  ): Promise<number> {
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
      const kind: FxProviderFailureKind =
        response.status === 401 || response.status === 403
          ? 'auth'
          : response.status === 429 || response.status >= 500
            ? 'transient'
            : 'provider';
      throw new FxProviderError(
        `HTTP ${response.status}`,
        response.status,
        kind,
      );
    }

    const json: unknown = await response.json();
    const parsed = historicalSchema.safeParse(json);
    if (!parsed.success) {
      throw new FxProviderError('Unexpected FX response shape', null, 'shape');
    }
    if (parsed.data.success === false) {
      const providerMessage =
        parsed.data.error?.info ?? 'FX provider rejected request';
      const auth = /access key|unauthori[sz]ed|invalid key|forbidden/i.test(
        providerMessage,
      );
      const transient =
        /quota|rate limit|too many|limit exceeded|usage limit/i.test(
          providerMessage,
        );
      const noData = /no data|not found|no result|no rate|not available/i.test(
        providerMessage,
      );
      const kind: FxProviderFailureKind = auth
        ? 'auth'
        : transient
          ? 'transient'
          : noData
            ? 'no_rate'
            : 'provider';
      throw new FxProviderError(providerMessage, null, kind);
    }

    const quoteKey = `${from}${to}`;
    const fromQuotes =
      parsed.data.quotes?.[quoteKey] ?? parsed.data.quotes?.[to];
    const fromRates = parsed.data.rates?.[to];
    const rate = fromQuotes ?? fromRates;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
      throw new FxProviderError(`Missing rate for ${to}`, null, 'no_rate');
    }
    return rate;
  }
}
