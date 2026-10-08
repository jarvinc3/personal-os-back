import { BadRequestException } from '@nestjs/common';
import type { ResolveAmountsUseCase } from '../../fx/application/resolve-amounts.use-case';
import type { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import type { BalanceSheetRepository } from '../infrastructure/balance-sheet.repository';
import { BalanceSheetService } from './balance-sheet.service';

describe('BalanceSheetService', () => {
  const loadPositions = jest.fn();
  const toBaseCurrency = jest.fn();
  const baseCurrencyExecute = jest.fn().mockResolvedValue('DOP');

  const createService = () =>
    new BalanceSheetService(
      { loadPositions } as unknown as BalanceSheetRepository,
      { toBaseCurrency } as unknown as ResolveAmountsUseCase,
      {
        execute: baseCurrencyExecute,
      } as unknown as ResolveUserBaseCurrencyUseCase,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    baseCurrencyExecute.mockResolvedValue('DOP');
    toBaseCurrency.mockImplementation((amount: number, currency: string) => {
      if (currency === 'USD') {
        return Promise.resolve(amount * 60);
      }
      return Promise.resolve(amount);
    });
  });

  it('uses limit minus available for credit debt (48000 - 42000 = 6000)', async () => {
    loadPositions.mockResolvedValue({
      institutions: [{ id: 'inst-1' }],
      accounts: [
        {
          id: 'acc-1',
          institutionId: 'inst-1',
          currency: 'DOP',
          balance: 150000,
        },
      ],
      cardBalances: [
        {
          currency: 'DOP',
          balance: 42000,
          creditLimit: 48000,
          card: { id: 'card-1', institutionId: 'inst-1' },
        },
      ],
      loans: [
        {
          id: 'loan-1',
          institutionId: 'inst-1',
          currency: 'DOP',
          currentBalance: 13500,
        },
      ],
    });

    const result = await createService().getBalanceSheet('user-1');

    expect(result.baseCurrency).toBe('DOP');
    expect(result.global).toMatchObject({
      status: 'COMPLETE',
      assets: { accounts: '150000' },
      liabilities: { creditCards: '6000', loans: '13500' },
      totalAssets: '150000',
      totalLiabilities: '19500',
      netWorth: '130500',
      issues: [],
    });
    expect(result.institutions).toEqual([
      expect.objectContaining({
        institutionId: 'inst-1',
        status: 'COMPLETE',
        netWorth: '130500',
        liabilities: { creditCards: '6000', loans: '13500' },
      }),
    ]);
  });

  it('converts mixed currencies before aggregating', async () => {
    loadPositions.mockResolvedValue({
      institutions: [{ id: 'inst-1' }],
      accounts: [
        {
          id: 'acc-dop',
          institutionId: 'inst-1',
          currency: 'DOP',
          balance: 1000,
        },
        {
          id: 'acc-usd',
          institutionId: 'inst-1',
          currency: 'USD',
          balance: 10,
        },
      ],
      cardBalances: [],
      loans: [],
    });

    const result = await createService().getBalanceSheet('user-1');

    expect(toBaseCurrency).toHaveBeenCalledWith(
      10,
      'USD',
      'DOP',
      expect.any(Date),
    );
    expect(result.global.netWorth).toBe('1600');
    expect(result.global.assets.accounts).toBe('1600');
  });

  it('ignores debit-only positions because the repository only returns CREDIT cards', async () => {
    loadPositions.mockResolvedValue({
      institutions: [{ id: 'inst-1' }],
      accounts: [
        {
          id: 'acc-1',
          institutionId: 'inst-1',
          currency: 'DOP',
          balance: 100,
        },
      ],
      cardBalances: [],
      loans: [],
    });

    const result = await createService().getBalanceSheet('user-1');
    expect(result.global.liabilities.creditCards).toBe('0');
    expect(result.global.netWorth).toBe('100');
  });

  it('marks global and the affected institution incomplete when a credit limit is missing', async () => {
    loadPositions.mockResolvedValue({
      institutions: [{ id: 'inst-1' }, { id: 'inst-2' }],
      accounts: [
        {
          id: 'acc-1',
          institutionId: 'inst-1',
          currency: 'DOP',
          balance: 100,
        },
        {
          id: 'acc-2',
          institutionId: 'inst-2',
          currency: 'DOP',
          balance: 50,
        },
      ],
      cardBalances: [
        {
          currency: 'DOP',
          balance: 10,
          creditLimit: null,
          card: { id: 'card-1', institutionId: 'inst-1' },
        },
      ],
      loans: [],
    });

    const result = await createService().getBalanceSheet('user-1');

    expect(result.global.status).toBe('INCOMPLETE');
    expect(result.global.liabilities.creditCards).toBeNull();
    expect(result.global.totalLiabilities).toBeNull();
    expect(result.global.netWorth).toBeNull();
    expect(result.global.assets.accounts).toBe('150');
    expect(result.global.issues).toEqual([
      { code: 'MISSING_CREDIT_LIMIT', cardId: 'card-1', currency: 'DOP' },
    ]);

    const inst1 = result.institutions.find(
      (row) => row.institutionId === 'inst-1',
    );
    const inst2 = result.institutions.find(
      (row) => row.institutionId === 'inst-2',
    );
    expect(inst1?.status).toBe('INCOMPLETE');
    expect(inst1?.netWorth).toBeNull();
    expect(inst2?.status).toBe('COMPLETE');
    expect(inst2?.netWorth).toBe('50');
  });

  it('includes unlinked cash and loans only in the global slice', async () => {
    loadPositions.mockResolvedValue({
      institutions: [{ id: 'inst-1' }],
      accounts: [
        {
          id: 'cash-1',
          institutionId: null,
          currency: 'DOP',
          balance: 25,
        },
        {
          id: 'acc-1',
          institutionId: 'inst-1',
          currency: 'DOP',
          balance: 10,
        },
      ],
      cardBalances: [],
      loans: [
        {
          id: 'loan-1',
          institutionId: null,
          currency: 'DOP',
          currentBalance: 4,
        },
      ],
    });

    const result = await createService().getBalanceSheet('user-1');
    expect(result.global.netWorth).toBe('31');
    expect(result.institutions[0]?.netWorth).toBe('10');
    expect(result.institutions[0]?.liabilities.loans).toBe('0');
  });

  it('propagates a missing exchange rate as a 400', async () => {
    loadPositions.mockResolvedValue({
      institutions: [],
      accounts: [
        {
          id: 'acc-1',
          institutionId: null,
          currency: 'EUR',
          balance: 5,
        },
      ],
      cardBalances: [],
      loans: [],
    });
    toBaseCurrency.mockRejectedValue(
      new BadRequestException(
        'Exchange rate unavailable for EUR->DOP on 2026-09-11: missing',
      ),
    );

    await expect(
      createService().getBalanceSheet('user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
