import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';

/** Tope de monedas cotizadas por petición. */
export const MAX_EXCHANGE_RATE_QUOTES = 20;

/** Acepta `?quotes=USD,EUR` o un parámetro repetido. */
function toQuoteList(value: unknown): string[] {
  return quoteEntries(value)
    .map((entry) => String(entry).trim())
    .filter((entry) => entry.length > 0);
}

function quoteEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    return value.split(',');
  }
  return [];
}

export class ExchangeRatesQueryDto {
  @ApiProperty({ example: 'DOP', description: 'ISO-3 base currency' })
  @IsString()
  base!: string;

  @ApiProperty({
    example: 'USD,EUR',
    description: `Comma-separated ISO-3 currency codes, at most ${MAX_EXCHANGE_RATE_QUOTES}`,
    type: [String],
    maxItems: MAX_EXCHANGE_RATE_QUOTES,
  })
  @Transform(({ value }) => toQuoteList(value))
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_EXCHANGE_RATE_QUOTES)
  @IsString({ each: true })
  quotes!: string[];
}
