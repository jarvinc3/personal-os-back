import type { ResolvedAmounts } from '../../shared/domain/money';

export type RateMetadataScope = 'source' | 'destination';

/**
 * Deja en `aiMetadata` la fecha y el valor de la tasa que se aplicó. La pata
 * de origen usa los campos base; la de destino usa el prefijo `destination`
 * para no pisar la trazabilidad de la otra pata.
 */
export function withRateMetadata({
  aiMetadata,
  amounts,
  scope = 'source',
}: {
  aiMetadata: unknown;
  amounts: ResolvedAmounts;
  scope?: RateMetadataScope;
}): Record<string, unknown> {
  const baseMetadata =
    aiMetadata && typeof aiMetadata === 'object' && !Array.isArray(aiMetadata)
      ? aiMetadata
      : {};
  const dateKey =
    scope === 'destination'
      ? 'destinationExchangeRateDate'
      : 'exchangeRateDate';
  const baseValueKey =
    scope === 'destination'
      ? 'destinationBaseExchangeRate'
      : 'baseExchangeRate';
  const baseDateKey =
    scope === 'destination'
      ? 'destinationBaseExchangeRateDate'
      : 'baseExchangeRateDate';
  return {
    ...baseMetadata,
    ...(amounts.exchangeRateDate
      ? { [dateKey]: amounts.exchangeRateDate }
      : {}),
    ...(amounts.baseExchangeRateDate
      ? {
          [baseValueKey]: amounts.baseExchangeRate,
          [baseDateKey]: amounts.baseExchangeRateDate,
        }
      : {}),
  };
}
