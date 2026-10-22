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
  const getLatestRateOnOrBefore = jest.fn().mockResolvedValue({
    ok: false,
    code: 'RATE_UNAVAILABLE',
    message: 'missing',
    retryable: false,
  } satisfies ExchangeRateResult);
  const useCase = new ResolveAmountsUseCase({
    getHistoricalRate,
    getLatestRateOnOrBefore,
  } as never);
  return { useCase, getHistoricalRate, getLatestRateOnOrBefore };
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

  it('falls back to the latest rate on or before the day', async () => {
    const { useCase, getLatestRateOnOrBefore } = build();
    getLatestRateOnOrBefore.mockResolvedValue({
      ok: true,
      rate: 2,
      source: 'cache',
    });

    const converted = await useCase.toBaseCurrencyOrNull(
      '10',
      'DOP',
      'EUR',
      asOf,
    );

    expect(converted?.toFixed(2)).toBe('20.00');
    expect(getLatestRateOnOrBefore).toHaveBeenCalledWith({
      from: 'DOP',
      to: 'EUR',
      date: '2026-10-08',
    });
  });

  it('returns null when neither the day nor an earlier rate exists', async () => {
    const { useCase } = build();

    await expect(
      useCase.toBaseCurrencyOrNull('10', 'DOP', 'EUR', asOf),
    ).resolves.toBeNull();
  });

  it('uses the received amount as the destination value', async () => {
    const { useCase } = build();

    const destination = await useCase.resolveTransferDestination({
      sourceAmount: 100,
      sourceCurrency: 'DOP',
      destinationCurrency: 'USD',
      receivedAmount: 2,
      baseCurrency: 'USD',
      transactionDate: asOf,
    });

    expect(destination.estimated).toBe(false);
    expect(destination.amounts).toMatchObject({
      amount: 2,
      currency: 'USD',
      ledgerAmount: 2,
      ledgerCurrency: 'USD',
      exchangeRate: 0.02,
    });
  });

  it('computes the received amount from a user rate', async () => {
    const { useCase } = build();

    const destination = await useCase.resolveTransferDestination({
      sourceAmount: 100,
      sourceCurrency: 'DOP',
      destinationCurrency: 'USD',
      exchangeRate: 0.02,
      baseCurrency: 'USD',
      transactionDate: asOf,
    });

    expect(destination.estimated).toBe(false);
    expect(destination.amounts).toMatchObject({
      amount: 2,
      ledgerAmount: 2,
      ledgerCurrency: 'USD',
      exchangeRate: 0.02,
    });
  });

  it('marks the market-rate destination as estimated', async () => {
    const { useCase } = build();

    const destination = await useCase.resolveTransferDestination({
      sourceAmount: 100,
      sourceCurrency: 'DOP',
      destinationCurrency: 'USD',
      baseCurrency: 'USD',
      transactionDate: asOf,
    });

    expect(destination.estimated).toBe(true);
    expect(destination.amounts.ledgerAmount).toBe(1.81);
    expect(destination.amounts.exchangeRate).toBe(0.018123);
  });
});
