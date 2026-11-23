import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';
import { PrismaService } from '@personal-os/database';
import { normalizeCurrencyCode } from '../../shared/domain/money';
import type {
  ExchangeRatePort,
  ExchangeRateResult,
} from '../application/ports/exchange-rate.port';
import { ExchangeRateHostClient } from './exchange-rate-host.client';
import { mapProviderFailure } from './exchange-rate-host.failure';

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

/** Un feriado largo puede dejar varios días sin publicación. */
const LAST_PUBLISHED_LOOKBACK_DAYS = 14;

@Injectable()
export class ExchangeRateHostAdapter implements ExchangeRatePort {
  private readonly logger = new Logger(ExchangeRateHostAdapter.name);
  private readonly client: ExchangeRateHostClient;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {
    this.client = new ExchangeRateHostClient(config, this.logger);
  }

  async listCurrencies(): Promise<string[]> {
    const codes = new Set<string>(['DOP']);
    const rows = await this.prisma.finExchangeRate.findMany({
      select: { fromCurrency: true, toCurrency: true },
    });
    for (const row of rows) {
      codes.add(row.fromCurrency);
      codes.add(row.toCurrency);
    }

    for (const code of await this.client.fetchCurrencyCodes()) {
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
      const rate = await this.client.fetchRate({
        from,
        to,
        date: params.date,
        accessKey: apiKey,
      });
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
    const report = mapProviderFailure({ from, to, date, error });
    if (report.logMessage) {
      this.logger.warn(report.logMessage);
    }
    return report.result;
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
}
