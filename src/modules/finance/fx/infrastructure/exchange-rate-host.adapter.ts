import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { Env } from '../../../../config';
import { PrismaService } from '../../../../prisma/prisma.service';
import { normalizeCurrencyCode } from '../../shared/domain/money';
import type {
    ExchangeRatePort,
    ExchangeRateResult,
} from '../application/ports/exchange-rate.port';

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

@Injectable()
export class ExchangeRateHostAdapter implements ExchangeRatePort {
  private readonly logger = new Logger(ExchangeRateHostAdapter.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {}

  async getHistoricalRate(params: {
    from: string;
    to: string;
    date: string;
  }): Promise<ExchangeRateResult> {
    const from = normalizeCurrencyCode(params.from);
    const to = normalizeCurrencyCode(params.to);
    if (from === to) {
      return { ok: true, rate: 1, source: 'identity' };
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
      return { ok: true, rate: Number(cached.rate), source: 'cache' };
    }

    const apiKey = this.config.get('EXCHANGE_RATE_HOST_API_KEY', { infer: true });
    if (!apiKey) {
      return {
        ok: false,
        code: 'RATE_UNAVAILABLE',
        message: 'EXCHANGE_RATE_HOST_API_KEY is not configured and no cached rate exists',
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
      return { ok: true, rate, source: 'api' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `FX API failed for ${from}->${to} on ${params.date}: ${message}`,
      );

      // Policy: only exact-date cache (already missed above). No "latest rate".
      return {
        ok: false,
        code: 'RATE_UNAVAILABLE',
        message: `No exact-date rate for ${from}->${to} on ${params.date}`,
        retryable: true,
      };
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
      throw new Error(`HTTP ${response.status}`);
    }

    const json: unknown = await response.json();
    const parsed = historicalSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error('Unexpected FX response shape');
    }
    if (parsed.data.success === false) {
      throw new Error(parsed.data.error?.info ?? 'FX provider rejected request');
    }

    const quoteKey = `${from}${to}`;
    const fromQuotes = parsed.data.quotes?.[quoteKey] ?? parsed.data.quotes?.[to];
    const fromRates = parsed.data.rates?.[to];
    const rate = fromQuotes ?? fromRates;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
      throw new Error(`Missing rate for ${to}`);
    }
    return rate;
  }
}
