import { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';
import {
  isIsoCurrency,
  normalizeCurrencyCode,
} from '../../shared/domain/money';

/** Finance settings read and written when the user changes base currency. */
export class FinanceBaseCurrencySettings {
  constructor(private readonly config: ConfigService<Env, true>) {}

  previousFrom(configured: unknown): string {
    const normalized =
      typeof configured === 'string' ? normalizeCurrencyCode(configured) : '';
    if (isIsoCurrency(normalized)) {
      return normalized;
    }
    return this.config.get('BASE_CURRENCY', { infer: true });
  }

  withBaseCurrency(
    currentConfig: Record<string, unknown>,
    nextBaseCurrency: string,
    previousBaseCurrency: string,
  ): Record<string, unknown> {
    const configuredTracked = Array.isArray(currentConfig.trackedCurrencies)
      ? currentConfig.trackedCurrencies
      : [];
    const withoutNext = configuredTracked
      .map((code) => normalizeCurrencyCode(String(code)))
      .filter((code) => code && code !== nextBaseCurrency);
    const trackedCurrencies = [
      previousBaseCurrency,
      ...withoutNext.filter((code) => code !== previousBaseCurrency),
    ];
    return {
      ...currentConfig,
      baseCurrency: nextBaseCurrency,
      trackedCurrencies,
    };
  }
}
