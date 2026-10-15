import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@personal-os/database';
import type { ResolveAmountsUseCase } from '../../fx/application/resolve-amounts.use-case';
import type { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import type { BalanceSheetRepository } from '../infrastructure/balance-sheet.repository';
import { BalanceSheetService } from './balance-sheet.service';

describe('BalanceSheetService', () => {
  const loadPositions = jest.fn();
  const loadCashAccounts = jest.fn();
  const toBaseCurrency = jest.fn();
  const toBaseCurrencyOrNull = jest.fn();
  const baseCurrencyExecute = jest.fn().mockResolvedValue('DOP');

  const createService = () =>
    new BalanceSheetService(
      { loadPositions, loadCashAccounts } as unknown as BalanceSheetRepository,
      {
        toBaseCurrency,
        toBaseCurrencyOrNull,
      } as unknown as ResolveAmountsUseCase,
      {
        execute: baseCurrencyExecute,
      } as unknown as ResolveUserBaseCurrencyUseCase,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    baseCurrencyExecute.mockResolvedValue('DOP');
    loadCashAccounts.mockResolvedValue([]);
    toBaseCurrency.mockImplementation((amount: number, currency: string) => {
      if (currency === 'USD') {
        return Promise.resolve(amount * 60);
      }
      return Promise.resolve(amount);
    });
    toBaseCurrencyOrNull.mockImplementation(
      (amount: number, currency: string, base: string, asOf: Date) =>
        toBaseCurrency(amount, currency, base, asOf),
    );
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

    const balanceSheet = await createService().getBalanceSheet('user-1');

    expect(balanceSheet.baseCurrency).toBe('DOP');
    expect(balanceSheet.global).toMatchObject({
      status: 'COMPLETE',
      assets: { accounts: '150000' },
      liabilities: { creditCards: '6000', loans: '13500' },
      totalAssets: '150000',
      totalLiabilities: '19500',
      netWorth: '130500',
      issues: [],
    });
    expect(balanceSheet.institutions).toEqual([
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

    const balanceSheet = await createService().getBalanceSheet('user-1');

    expect(toBaseCurrencyOrNull).toHaveBeenCalledWith(
      10,
      'USD',
      'DOP',
      expect.any(Date),
    );
    expect(balanceSheet.global.netWorth).toBe('1600');
    expect(balanceSheet.global.assets.accounts).toBe('1600');
  });

  it('sums converted balances to the cent, rounding once at the end', async () => {
    toBaseCurrency.mockImplementation((amount: number, currency: string) =>
      Promise.resolve(
        currency === 'USD'
          ? new Prisma.Decimal(amount).times('60.5')
          : new Prisma.Decimal(amount),
      ),
    );
    loadPositions.mockResolvedValue({
      institutions: [{ id: 'inst-1' }],
      accounts: [
        {
          id: 'acc-dop',
          institutionId: 'inst-1',
          currency: 'DOP',
          balance: '100.10',
        },
        {
          id: 'acc-usd',
          institutionId: 'inst-1',
          currency: 'USD',
          balance: '10.05',
        },
      ],
      cardBalances: [],
      loans: [],
    });

    const balanceSheet = await createService().getBalanceSheet('user-1');

    // 100.10 + (10.05 * 60.5 = 608.025) = 708.125, a half cent rounded down.
    expect(balanceSheet.global.assets.accounts).toBe('708.12');
    expect(balanceSheet.global.netWorth).toBe('708.12');
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

    const balanceSheet = await createService().getBalanceSheet('user-1');
    expect(balanceSheet.global.liabilities.creditCards).toBe('0');
    expect(balanceSheet.global.netWorth).toBe('100');
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

    const balanceSheet = await createService().getBalanceSheet('user-1');

    expect(balanceSheet.global.status).toBe('INCOMPLETE');
    expect(balanceSheet.global.liabilities.creditCards).toBeNull();
    expect(balanceSheet.global.totalLiabilities).toBeNull();
    expect(balanceSheet.global.netWorth).toBeNull();
    expect(balanceSheet.global.assets.accounts).toBe('150');
    expect(balanceSheet.global.issues).toEqual([
      { code: 'MISSING_CREDIT_LIMIT', cardId: 'card-1', currency: 'DOP' },
    ]);

    const inst1 = balanceSheet.institutions.find(
      (row) => row.institutionId === 'inst-1',
    );
    const inst2 = balanceSheet.institutions.find(
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

    const balanceSheet = await createService().getBalanceSheet('user-1');
    expect(balanceSheet.global.netWorth).toBe('31');
    expect(balanceSheet.institutions[0]?.netWorth).toBe('10');
    expect(balanceSheet.institutions[0]?.liabilities.loans).toBe('0');
  });

  it('marks an account with no rate incomplete instead of failing the balanceSheet', async () => {
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
    toBaseCurrencyOrNull.mockResolvedValue(null);

    const balanceSheet = await createService().getBalanceSheet('user-1');

    expect(balanceSheet.global.status).toBe('INCOMPLETE');
    expect(balanceSheet.global.assets.accounts).toBe('0');
    expect(balanceSheet.global.netWorth).toBeNull();
    expect(balanceSheet.global.issues).toEqual([
      { code: 'MISSING_RATE', currency: 'EUR' },
    ]);
  });

  it('still fails the balanceSheet when a card currency has no rate', async () => {
    loadPositions.mockResolvedValue({
      institutions: [{ id: 'inst-1' }],
      accounts: [],
      cardBalances: [
        {
          currency: 'EUR',
          balance: 10,
          creditLimit: 100,
          card: { id: 'card-1', institutionId: 'inst-1' },
        },
      ],
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

  it('converts cash to the base currency and breaks it down by currency', async () => {
    loadCashAccounts.mockResolvedValue([
      { id: 'cash-dop', name: 'Efectivo', currency: 'DOP', balance: '1000.00' },
      {
        id: 'cash-usd',
        name: 'Efectivo USD',
        currency: 'USD',
        balance: '10.00',
      },
    ]);

    const balanceSheet = await createService().getBalanceSheet('user-1');

    expect(balanceSheet.cash.status).toBe('COMPLETE');
    expect(balanceSheet.cash.totalBase).toBe('1600');
    expect(balanceSheet.cash.baseCurrency).toBe('DOP');
    expect(balanceSheet.cash.byCurrency).toEqual([
      {
        currency: 'DOP',
        total: '1000',
        totalBase: '1000',
        accounts: [{ id: 'cash-dop', name: 'Efectivo', balance: '1000.00' }],
      },
      {
        currency: 'USD',
        total: '10',
        totalBase: '600',
        accounts: [{ id: 'cash-usd', name: 'Efectivo USD', balance: '10.00' }],
      },
    ]);
  });

  it('keeps the cash breakdown and marks the total incomplete when a rate is missing', async () => {
    loadCashAccounts.mockResolvedValue([
      { id: 'cash-dop', name: 'Efectivo', currency: 'DOP', balance: '1000.00' },
      {
        id: 'cash-eur',
        name: 'Efectivo EUR',
        currency: 'EUR',
        balance: '10.00',
      },
    ]);
    toBaseCurrencyOrNull.mockImplementation(
      (amount: Prisma.Decimal, currency: string) =>
        Promise.resolve(currency === 'EUR' ? null : amount),
    );

    const balanceSheet = await createService().getBalanceSheet('user-1');

    expect(balanceSheet.cash.status).toBe('INCOMPLETE');
    expect(balanceSheet.cash.totalBase).toBeNull();
    expect(balanceSheet.cash.byCurrency).toEqual([
      {
        currency: 'DOP',
        total: '1000',
        totalBase: '1000',
        accounts: [{ id: 'cash-dop', name: 'Efectivo', balance: '1000.00' }],
      },
      {
        currency: 'EUR',
        total: '10',
        totalBase: null,
        accounts: [{ id: 'cash-eur', name: 'Efectivo EUR', balance: '10.00' }],
      },
    ]);
  });
});
