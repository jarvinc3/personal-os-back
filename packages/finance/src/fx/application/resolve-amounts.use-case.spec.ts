import { BadRequestException } from '@nestjs/common';
import type { ExchangeRateResult } from './ports/exchange-rate.port';
import { ResolveAmountsUseCase } from './resolve-amounts.use-case';

const asOf = new Date('2026-10-08T12:00:00.000Z');

function rateFor(from: string, to: string): ExchangeRateResult {
  if (from === to) {
    return { ok: true, rate: 1, source: 'identity' };
  }
  if (from === 'DOP' && to === 'USD') {
    return { ok: true, rate: 0.018123, source: 'cache' };
  }
  return {
    ok: false,
    code: 'RATE_UNAVAILABLE',
    message: 'missing',
    retryable: false,
  };
}

function build() {
  const getHistoricalRate = jest
    .fn()
    .mockImplementation((params: { from: string; to: string }) =>
      Promise.resolve(rateFor(params.from, params.to)),
    );
  const useCase = new ResolveAmountsUseCase({ getHistoricalRate } as never);
  return { useCase, getHistoricalRate };
}

describe('ResolveAmountsUseCase', () => {
  it('converts a million DOP to USD without losing a cent', async () => {
    const { useCase } = build();

    const resolved = await useCase.execute({
      amount: 1_000_000,
      currency: 'DOP',
      ledgerCurrency: 'DOP',
      baseCurrency: 'USD',
      transactionDate: asOf,
    });

    expect(resolved).toEqual({
      amount: 1_000_000,
      currency: 'DOP',
      ledgerAmount: 1_000_000,
      ledgerCurrency: 'DOP',
      amountBaseCurrency: 18123,
      exchangeRate: 1,
    });
  });

  it('converts a position to the base currency exactly', async () => {
    const { useCase } = build();

    const converted = await useCase.toBaseCurrency(
      '1000000',
      'DOP',
      'USD',
      asOf,
    );

    expect(converted.toFixed(2)).toBe('18123.00');
  });

  it('rounds a half cent to the even cent (ROUND_HALF_EVEN)', async () => {
    const { useCase } = build();

    const converted = await useCase.toBaseCurrency('0.125', 'USD', 'USD', asOf);

    expect(converted.toFixed(2)).toBe('0.12');
  });

  it('fails closed when the rate is unavailable', async () => {
    const { useCase, getHistoricalRate } = build();
    getHistoricalRate.mockResolvedValue({
      ok: false,
      code: 'RATE_UNAVAILABLE',
      message: 'missing',
      retryable: false,
    });

    await expect(
      useCase.toBaseCurrency('10', 'DOP', 'EUR', asOf),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
