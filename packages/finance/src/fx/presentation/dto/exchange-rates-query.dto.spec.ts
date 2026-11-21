import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ExchangeRatesQueryDto,
  MAX_EXCHANGE_RATE_QUOTES,
} from './exchange-rates-query.dto';

function toDto(quotes: string) {
  return plainToInstance(ExchangeRatesQueryDto, { base: 'DOP', quotes });
}

function quoteList(size: number): string {
  return Array.from(
    { length: size },
    (_, index) => `X${String(index).padStart(2, '0')}`,
  ).join(',');
}

describe('ExchangeRatesQueryDto', () => {
  it('splits and trims a comma-separated list', async () => {
    const dto = toDto('USD, EUR');

    expect(dto.quotes).toEqual(['USD', 'EUR']);
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it(`accepts up to ${MAX_EXCHANGE_RATE_QUOTES} quotes`, async () => {
    await expect(
      validate(toDto(quoteList(MAX_EXCHANGE_RATE_QUOTES))),
    ).resolves.toHaveLength(0);
  });

  it(`rejects more than ${MAX_EXCHANGE_RATE_QUOTES} quotes`, async () => {
    const errors = await validate(
      toDto(quoteList(MAX_EXCHANGE_RATE_QUOTES + 1)),
    );
    const quotesError = errors.find((error) => error.property === 'quotes');

    expect(quotesError?.constraints).toHaveProperty('arrayMaxSize');
  });

  it('rejects an empty list', async () => {
    const errors = await validate(toDto(''));

    expect(errors.some((error) => error.property === 'quotes')).toBe(true);
  });
});
