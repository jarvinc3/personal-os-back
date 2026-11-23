import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ExchangeRateResult } from './ports/exchange-rate.port';
import {
  ResolveAmountsUseCase,
  type FxRateRequestCache,
} from './resolve-amounts.use-case';

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
  const getLedgerRate = jest
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
    getLedgerRate,
    getLatestRateOnOrBefore,
  } as never);
  return {
    useCase,
    getHistoricalRate,
    getLedgerRate,
    getLatestRateOnOrBefore,
  };
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
      exchangeRateDate: '2026-10-08',
      baseExchangeRate: 0.018123,
      baseExchangeRateDate: '2026-10-08',
    });
  });

  it('converts a position to the base currency exactly', async () => {
    const { useCase } = build();

    const converted = await useCase.toBaseCurrency({
      amount: '1000000',
      currency: 'DOP',
      baseCurrency: 'USD',
      asOf,
    });

    expect(converted.toFixed(2)).toBe('18123.00');
  });

  it('rounds a half cent to the even cent (ROUND_HALF_EVEN)', async () => {
    const { useCase } = build();

    const converted = await useCase.toBaseCurrency({
      amount: '0.125',
      currency: 'USD',
      baseCurrency: 'USD',
      asOf,
    });

    expect(converted.toFixed(2)).toBe('0.12');
  });

  it('fails closed when the rate is unavailable', async () => {
    const { useCase, getLedgerRate } = build();
    getLedgerRate.mockResolvedValue({
      ok: false,
      code: 'RATE_UNAVAILABLE',
      message: 'missing',
      retryable: false,
    });

    await expect(
      useCase.toBaseCurrency({
        amount: '10',
        currency: 'DOP',
        baseCurrency: 'EUR',
        asOf,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not disguise a provider auth failure as a missing exact rate', async () => {
    const { useCase, getLedgerRate } = build();
    getLedgerRate.mockResolvedValue({
      ok: false,
      code: 'PROVIDER_UNAUTHORIZED',
      message: 'FX provider unauthorized (HTTP 401) for USD->DOP on 2026-10-08',
      retryable: false,
      providerStatus: 401,
    });

    await expect(
      useCase.execute({
        amount: 59.99,
        currency: 'USD',
        ledgerCurrency: 'DOP',
        baseCurrency: 'DOP',
        transactionDate: asOf,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('records the date of the last published rate used', async () => {
    const { useCase, getLedgerRate } = build();
    getLedgerRate.mockResolvedValue({
      ok: true,
      rate: 60.4617,
      source: 'cache_last_published',
      rateDate: '2026-10-06',
    });

    const resolved = await useCase.execute({
      amount: 59.99,
      currency: 'USD',
      ledgerCurrency: 'DOP',
      baseCurrency: 'DOP',
      transactionDate: asOf,
    });

    expect(resolved.exchangeRateDate).toBe('2026-10-06');
    expect(resolved.baseExchangeRateDate).toBe('2026-10-06');
  });

  it('falls back to the latest rate on or before the day', async () => {
    const { useCase, getLatestRateOnOrBefore } = build();
    getLatestRateOnOrBefore.mockResolvedValue({
      ok: true,
      rate: 2,
      source: 'cache',
    });

    const converted = await useCase.toBaseCurrencyOrNull({
      amount: '10',
      currency: 'DOP',
      baseCurrency: 'EUR',
      asOf,
    });

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
      useCase.toBaseCurrencyOrNull({
        amount: '10',
        currency: 'DOP',
        baseCurrency: 'EUR',
        asOf,
      }),
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

  it('reuses an exact rate within the request cache', async () => {
    const { useCase, getHistoricalRate, getLedgerRate } = build();
    getHistoricalRate.mockResolvedValue({
      ok: true,
      rate: 60,
      source: 'cache',
      rateDate: '2026-10-08',
    });
    const cache: FxRateRequestCache = new Map();

    await useCase.toBaseCurrencyOrNull({
      amount: '10',
      currency: 'USD',
      baseCurrency: 'DOP',
      asOf,
      cache,
    });
    await useCase.toBaseCurrency({
      amount: '20',
      currency: 'USD',
      baseCurrency: 'DOP',
      asOf,
      cache,
    });

    expect(getHistoricalRate).toHaveBeenCalledTimes(1);
    expect(getLedgerRate).not.toHaveBeenCalled();
  });

  it('reuses a ledger rate within the request cache', async () => {
    const { useCase, getHistoricalRate, getLedgerRate } = build();
    getLedgerRate.mockResolvedValue({
      ok: true,
      rate: 60,
      source: 'cache',
      rateDate: '2026-10-08',
    });
    const cache: FxRateRequestCache = new Map();

    await useCase.toBaseCurrency({
      amount: '10',
      currency: 'USD',
      baseCurrency: 'DOP',
      asOf,
      cache,
    });
    await useCase.toBaseCurrencyOrNull({
      amount: '20',
      currency: 'USD',
      baseCurrency: 'DOP',
      asOf,
      cache,
    });

    expect(getLedgerRate).toHaveBeenCalledTimes(1);
    expect(getHistoricalRate).not.toHaveBeenCalled();
  });
});
