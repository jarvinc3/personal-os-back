import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ResolveAmountsUseCase } from '../../fx/application/resolve-amounts.use-case';
import { AnalyticsService } from './analytics.service';
import type { AnalyticsRepository } from '../infrastructure/analytics.repository';

describe('AnalyticsService.getAnalyticsSummary', () => {
  const getAnalyticsSummary = jest.fn();
  const toBaseCurrency = jest.fn();
  const configGet = jest.fn().mockReturnValue('DOP');

  const repo = {
    getAnalyticsSummary,
  } as unknown as AnalyticsRepository;

  const resolveAmounts = {
    toBaseCurrency,
  } as unknown as ResolveAmountsUseCase;

  const config = {
    get: configGet,
  } as unknown as ConfigService;

  const service = new AnalyticsService(repo, resolveAmounts, config as never);

  beforeEach(() => {
    jest.clearAllMocks();
    configGet.mockReturnValue('DOP');
    getAnalyticsSummary.mockResolvedValue({
      accounts: [
        { balance: 10000, currency: 'DOP' },
        { balance: 100, currency: 'USD' },
      ],
      cardBalances: [
        { balance: 50, currency: 'USD', card: { type: 'CREDIT' } },
        { balance: 10, currency: 'DOP', card: { type: 'DEBIT' } },
      ],
      aggregates: [],
    });
    toBaseCurrency.mockImplementation((amount: number, currency: string) => {
      if (currency === 'USD') return Promise.resolve(amount * 60);
      return Promise.resolve(amount);
    });
  });

  it('converts mixed-currency positions into BASE_CURRENCY', async () => {
    const result = await service.getAnalyticsSummary('user-1');

    expect(result.baseCurrency).toBe('DOP');
    expect(result.totals.accountBalance).toBe(16000);
    expect(result.totals.cardDebt).toBe(3000);
    expect(result.netWorth).toBe(13000);
    expect(toBaseCurrency).toHaveBeenCalledWith(10000, 'DOP', expect.any(Date));
    expect(toBaseCurrency).toHaveBeenCalledWith(100, 'USD', expect.any(Date));
    expect(toBaseCurrency).toHaveBeenCalledWith(50, 'USD', expect.any(Date));
    expect(toBaseCurrency).not.toHaveBeenCalledWith(
      10,
      'DOP',
      expect.any(Date),
    );
  });

  it('keeps same-currency totals as a plain sum', async () => {
    getAnalyticsSummary.mockResolvedValue({
      accounts: [{ balance: 100, currency: 'DOP' }],
      cardBalances: [],
      aggregates: [],
    });
    toBaseCurrency.mockResolvedValue(100);

    const result = await service.getAnalyticsSummary('user-1');
    expect(result.totals.accountBalance).toBe(100);
    expect(result.netWorth).toBe(100);
  });

  it('fails closed when a rate for today is missing', async () => {
    toBaseCurrency.mockRejectedValue(
      new BadRequestException(
        'Exchange rate unavailable for USD->DOP on 2026-08-26: missing',
      ),
    );

    await expect(service.getAnalyticsSummary('user-1')).rejects.toThrow(
      /Exchange rate unavailable/,
    );
  });
});
