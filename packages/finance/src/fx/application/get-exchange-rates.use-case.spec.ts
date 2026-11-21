import { BadRequestException } from '@nestjs/common';
import { GetExchangeRatesUseCase } from './get-exchange-rates.use-case';

describe('GetExchangeRatesUseCase', () => {
  const getHistoricalRate = jest.fn();
  const useCase = new GetExchangeRatesUseCase({
    getHistoricalRate,
  } as never);
  const asOf = new Date('2026-10-08T12:00:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns decimal strings and null for a missing rate', async () => {
    getHistoricalRate
      .mockResolvedValueOnce({ ok: true, rate: 68.39, source: 'cache' })
      .mockResolvedValueOnce({
        ok: false,
        code: 'RATE_UNAVAILABLE',
        message: 'missing',
        retryable: true,
      });

    const ratesResult = await useCase.execute('DOP', ['USD', 'EUR'], asOf);

    expect(ratesResult).toEqual({
      baseCurrency: 'DOP',
      date: '2026-10-08',
      rates: [
        { currency: 'USD', rate: '68.39' },
        { currency: 'EUR', rate: null },
      ],
    });
    expect(getHistoricalRate).toHaveBeenCalledWith({
      from: 'USD',
      to: 'DOP',
      date: '2026-10-08',
    });
  });

  it('rejects an invalid base currency', async () => {
    await expect(useCase.execute('US', ['USD'], asOf)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects an invalid quote currency', async () => {
    await expect(useCase.execute('DOP', ['US'], asOf)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('quotes a repeated currency once', async () => {
    getHistoricalRate.mockResolvedValue({
      ok: true,
      rate: 68.39,
      source: 'cache',
    });

    const ratesResult = await useCase.execute(
      'DOP',
      ['USD', 'USD', 'EUR'],
      asOf,
    );

    expect(getHistoricalRate).toHaveBeenCalledTimes(2);
    expect(ratesResult.rates.map(({ currency }) => currency)).toEqual([
      'USD',
      'USD',
      'EUR',
    ]);
  });
});
