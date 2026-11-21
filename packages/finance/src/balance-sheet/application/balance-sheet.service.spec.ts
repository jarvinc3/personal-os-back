import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@personal-os/database';
import type { FinanceEntityLookupService } from '../../entities/application/finance-entity-lookup.service';
import { ResolveAmountsUseCase } from '../../fx/application/resolve-amounts.use-case';
import type { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import type { BalanceSheetRepository } from '../infrastructure/balance-sheet.repository';
import { BalanceSheetService } from './balance-sheet.service';

describe('BalanceSheetService', () => {
  const loadPositions = jest.fn();
  const loadCashAccounts = jest.fn();
  const loadReceivables = jest.fn();
  const loadOpenDrifts = jest.fn();
  const loadMonthReconciliations = jest.fn();
  const loadUserTimezone = jest.fn();
  const toBaseCurrency = jest.fn();
  const toBaseCurrencyOrNull = jest.fn();
  const baseCurrencyExecute = jest.fn().mockResolvedValue('DOP');
  const lookupByKey = jest.fn().mockResolvedValue(new Map());

  const repository = {
    loadPositions,
    loadCashAccounts,
    loadReceivables,
    loadOpenDrifts,
    loadMonthReconciliations,
    loadUserTimezone,
  };

  const createService = () =>
    new BalanceSheetService(
      repository as unknown as BalanceSheetRepository,
      {
        toBaseCurrency,
        toBaseCurrencyOrNull,
      } as unknown as ResolveAmountsUseCase,
      {
        execute: baseCurrencyExecute,
      } as unknown as ResolveUserBaseCurrencyUseCase,
      { lookupByKey } as unknown as FinanceEntityLookupService,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    baseCurrencyExecute.mockResolvedValue('DOP');
    loadCashAccounts.mockResolvedValue([]);
    loadReceivables.mockResolvedValue([]);
    loadOpenDrifts.mockResolvedValue([]);
    loadMonthReconciliations.mockResolvedValue([]);
    loadUserTimezone.mockResolvedValue(null);
    lookupByKey.mockResolvedValue(new Map());
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
      expect.anything(),
      expect.anything(),
    );
    expect(balanceSheet.global.netWorth).toBe('1600');
    expect(balanceSheet.global.assets.accounts).toBe('1600');
  });

  it('queries each pair and date once for twenty positions in three currencies', async () => {
    const getHistoricalRate = jest.fn(
      (params: { from: string; to: string; date: string }) =>
        Promise.resolve({
          ok: true,
          rate: params.from === params.to ? 1 : 60,
          source: 'cache',
          rateDate: params.date,
        }),
    );
    const getLedgerRate = jest.fn();
    const getLatestRateOnOrBefore = jest.fn();
    const service = new BalanceSheetService(
      repository as unknown as BalanceSheetRepository,
      new ResolveAmountsUseCase({
        getHistoricalRate,
        getLedgerRate,
        getLatestRateOnOrBefore,
      } as never),
      {
        execute: baseCurrencyExecute,
      } as unknown as ResolveUserBaseCurrencyUseCase,
      { lookupByKey } as unknown as FinanceEntityLookupService,
    );
    loadPositions.mockResolvedValue({
      institutions: [{ id: 'inst-1' }],
      accounts: Array.from({ length: 18 }, (_, index) => ({
        id: `acc-${index}`,
        institutionId: 'inst-1',
        currency: ['DOP', 'USD', 'EUR'][index % 3],
        balance: 100 + index,
      })),
      cardBalances: [
        {
          currency: 'USD',
          balance: 400,
          creditLimit: 1000,
          card: { id: 'card-1', institutionId: 'inst-1' },
        },
      ],
      loans: [
        {
          id: 'loan-1',
          institutionId: 'inst-1',
          currency: 'EUR',
          currentBalance: 300,
        },
      ],
    });

    await service.getBalanceSheet('user-1');

    expect(getHistoricalRate).toHaveBeenCalledTimes(3);
    expect(getLedgerRate).not.toHaveBeenCalled();
    expect(getLatestRateOnOrBefore).not.toHaveBeenCalled();
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

  it('includes pending receivables and keeps doubtful ones out of net worth', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const ninetyDaysAgo = new Date(
      new Date(`${today}T00:00:00.000Z`).getTime() - 90 * 24 * 60 * 60 * 1000,
    );
    const ninetyOneDaysAgo = new Date(
      new Date(`${today}T00:00:00.000Z`).getTime() - 91 * 24 * 60 * 60 * 1000,
    );
    loadPositions.mockResolvedValue({
      institutions: [],
      accounts: [],
      cardBalances: [],
      loans: [],
    });
    loadReceivables.mockResolvedValue([
      {
        id: 'rec-1',
        debtorName: 'Ana',
        description: 'Préstamo',
        amount: new Prisma.Decimal(100),
        paidAmount: new Prisma.Decimal(0),
        writtenOffAmount: new Prisma.Decimal(0),
        currency: 'DOP',
        dueDate: null,
      },
      {
        id: 'rec-2',
        debtorName: 'Luis',
        description: null,
        amount: new Prisma.Decimal(40),
        paidAmount: new Prisma.Decimal(0),
        writtenOffAmount: new Prisma.Decimal(0),
        currency: 'DOP',
        dueDate: ninetyDaysAgo,
      },
      {
        id: 'rec-3',
        debtorName: 'Marta',
        description: null,
        amount: new Prisma.Decimal(50),
        paidAmount: new Prisma.Decimal(0),
        writtenOffAmount: new Prisma.Decimal(0),
        currency: 'USD',
        dueDate: ninetyOneDaysAgo,
      },
      {
        id: 'rec-4',
        debtorName: 'Pedro',
        description: null,
        amount: new Prisma.Decimal(20),
        paidAmount: new Prisma.Decimal(20),
        writtenOffAmount: new Prisma.Decimal(0),
        currency: 'DOP',
        dueDate: null,
      },
    ]);
    toBaseCurrencyOrNull.mockImplementation(
      (amount: Prisma.Decimal, currency: string) =>
        Promise.resolve(
          currency === 'USD'
            ? new Prisma.Decimal(amount).times(60)
            : new Prisma.Decimal(amount),
        ),
    );

    const balanceSheet = await createService().getBalanceSheet('user-1');

    expect(balanceSheet.global.assets.receivables).toBe('140');
    expect(balanceSheet.global.totalAssets).toBe('140');
    expect(balanceSheet.global.netWorth).toBe('140');
    expect(balanceSheet.breakdown.totals).toEqual({
      assets: '140',
      available: '0',
      receivables: '140',
      liabilities: '0',
      netWorth: '140',
      doubtfulReceivables: '3000',
    });
    const usd = balanceSheet.breakdown.byCurrency.find(
      (group) => group.currency === 'USD',
    );
    expect(usd?.doubtfulReceivables).toEqual([
      expect.objectContaining({
        id: 'rec-3',
        doubtful: true,
        balance: '50',
        balanceBase: '3000',
      }),
    ]);
    expect(
      balanceSheet.breakdown.byCurrency
        .flatMap((group) => group.receivables)
        .map((line) => line.id),
    ).toEqual(['rec-1', 'rec-2']);
  });

  it('marks open drifts and the current-month reconciliation on each product line', async () => {
    loadPositions.mockResolvedValue({
      institutions: [],
      accounts: [
        {
          id: 'acc-1',
          name: 'Ahorros',
          type: 'SAVINGS',
          institutionId: null,
          currency: 'DOP',
          balance: new Prisma.Decimal(100),
        },
      ],
      cardBalances: [
        {
          currency: 'DOP',
          balance: new Prisma.Decimal(90),
          creditLimit: new Prisma.Decimal(100),
          card: { id: 'card-1', name: 'Visa', institutionId: null },
        },
      ],
      loans: [
        {
          id: 'loan-1',
          lenderName: 'Banco',
          institutionId: null,
          currency: 'DOP',
          currentBalance: new Prisma.Decimal(50),
        },
      ],
    });
    loadOpenDrifts.mockResolvedValue([
      {
        accountId: 'acc-1',
        cardId: null,
        currency: 'DOP',
        difference: new Prisma.Decimal(-10),
      },
      {
        accountId: null,
        cardId: 'card-1',
        currency: 'DOP',
        difference: new Prisma.Decimal(5),
      },
    ]);
    loadMonthReconciliations.mockResolvedValue([
      { accountId: 'acc-1', cardId: null, currency: 'DOP' },
    ]);

    const balanceSheet = await createService().getBalanceSheet('user-1');
    const lines = balanceSheet.breakdown.byCurrency.flatMap((group) => [
      ...group.accounts,
      ...group.creditCards,
      ...group.loans,
    ]);

    expect(lines.find((line) => line.id === 'acc-1')).toMatchObject({
      hasDrift: true,
      driftDifference: '-10',
      reconciliation: 'RECONCILED',
    });
    expect(lines.find((line) => line.id === 'card-1')).toMatchObject({
      hasDrift: true,
      driftDifference: '5',
      reconciliation: 'PENDING',
      creditLimit: '100',
      availableCredit: '90',
      balance: '10',
    });
    expect(lines.find((line) => line.id === 'loan-1')).toMatchObject({
      hasDrift: false,
      reconciliation: 'NOT_APPLICABLE',
      balance: '50',
    });
  });

  it('groups lines by currency and derives every total from them', async () => {
    loadPositions.mockResolvedValue({
      institutions: [],
      accounts: [
        {
          id: 'acc-dop',
          name: 'Cuenta DOP',
          type: 'CHECKING',
          institutionId: null,
          currency: 'DOP',
          balance: new Prisma.Decimal(100),
        },
        {
          id: 'acc-usd',
          name: 'Cuenta USD',
          type: 'CHECKING',
          institutionId: null,
          currency: 'USD',
          balance: new Prisma.Decimal(10),
        },
      ],
      cardBalances: [
        {
          currency: 'DOP',
          balance: new Prisma.Decimal(50),
          creditLimit: new Prisma.Decimal(100),
          card: { id: 'card-1', name: 'Visa', institutionId: null },
        },
      ],
      loans: [
        {
          id: 'loan-usd',
          lenderName: 'Banco',
          institutionId: null,
          currency: 'USD',
          currentBalance: new Prisma.Decimal(5),
        },
      ],
    });
    loadReceivables.mockResolvedValue([
      {
        id: 'rec-1',
        debtorName: 'Ana',
        description: null,
        amount: new Prisma.Decimal(25),
        paidAmount: new Prisma.Decimal(0),
        writtenOffAmount: new Prisma.Decimal(0),
        currency: 'DOP',
        dueDate: null,
      },
    ]);
    toBaseCurrency.mockImplementation(
      (amount: Prisma.Decimal, currency: string) =>
        Promise.resolve(
          currency === 'USD'
            ? new Prisma.Decimal(amount).times(60)
            : new Prisma.Decimal(amount),
        ),
    );
    toBaseCurrencyOrNull.mockImplementation(
      (amount: Prisma.Decimal, currency: string) =>
        Promise.resolve(
          currency === 'USD'
            ? new Prisma.Decimal(amount).times(60)
            : new Prisma.Decimal(amount),
        ),
    );

    const balanceSheet = await createService().getBalanceSheet('user-1');

    expect(balanceSheet.global).toMatchObject({
      assets: { accounts: '700', cash: '0', receivables: '25' },
      totalAssets: '725',
      liabilities: { creditCards: '50', loans: '300' },
      totalLiabilities: '350',
      netWorth: '375',
    });
    expect(balanceSheet.breakdown.totals).toEqual({
      assets: '725',
      available: '700',
      receivables: '25',
      liabilities: '350',
      netWorth: '375',
      doubtfulReceivables: '0',
    });
    expect(
      balanceSheet.breakdown.byCurrency.map((group) => group.currency),
    ).toEqual(['DOP', 'USD']);
    const dop = balanceSheet.breakdown.byCurrency[0];
    const usd = balanceSheet.breakdown.byCurrency[1];
    expect(dop.totals).toMatchObject({
      assets: '125',
      available: '100',
      receivables: '25',
      liabilities: '50',
      netWorth: '75',
    });
    expect(usd.totals).toMatchObject({
      assets: '10',
      available: '10',
      receivables: '0',
      liabilities: '5',
      netWorth: '5',
    });
  });

  it('keeps institution totals in their own currencies', async () => {
    loadPositions.mockResolvedValue({
      institutions: [{ id: 'inst-1' }],
      accounts: [
        {
          id: 'acc-dop',
          name: 'Cuenta DOP',
          type: 'CHECKING',
          institutionId: 'inst-1',
          currency: 'DOP',
          balance: new Prisma.Decimal(100),
        },
        {
          id: 'acc-usd',
          name: 'Cuenta USD',
          type: 'CHECKING',
          institutionId: 'inst-1',
          currency: 'USD',
          balance: new Prisma.Decimal(10),
        },
      ],
      cardBalances: [],
      loans: [],
    });
    toBaseCurrencyOrNull.mockImplementation(
      (amount: Prisma.Decimal, currency: string) =>
        Promise.resolve(
          currency === 'USD'
            ? new Prisma.Decimal(amount).times(60)
            : new Prisma.Decimal(amount),
        ),
    );

    const balanceSheet = await createService().getBalanceSheet('user-1');

    expect(balanceSheet.global.byCurrency).toEqual([
      {
        currency: 'DOP',
        assets: '100',
        available: '100',
        receivables: '0',
        liabilities: '0',
        netWorth: '100',
      },
      {
        currency: 'USD',
        assets: '10',
        available: '10',
        receivables: '0',
        liabilities: '0',
        netWorth: '10',
      },
    ]);
    expect(balanceSheet.institutions[0]?.byCurrency).toEqual(
      balanceSheet.global.byCurrency,
    );
  });
  it('attaches the full entity behind every line in a single lookup', async () => {
    loadPositions.mockResolvedValue({
      institutions: [],
      accounts: [
        {
          id: 'acc-1',
          institutionId: null,
          currency: 'DOP',
          balance: 1000,
        },
      ],
      cardBalances: [
        {
          currency: 'DOP',
          balance: 4,
          creditLimit: 10,
          card: { id: 'card-1', institutionId: null },
        },
      ],
      loans: [
        {
          id: 'loan-1',
          institutionId: null,
          currency: 'DOP',
          currentBalance: 5,
        },
      ],
    });
    lookupByKey.mockResolvedValue(
      new Map([
        ['account:acc-1', { id: 'acc-1', kind: 'account' }],
        ['card:card-1', { id: 'card-1', kind: 'card' }],
        ['loan:loan-1', { id: 'loan-1', kind: 'loan' }],
      ]),
    );

    const balanceSheet = await createService().getBalanceSheet('user-1');
    const lines = balanceSheet.breakdown.byCurrency.flatMap((group) => [
      ...group.accounts,
      ...group.cash,
      ...group.receivables,
      ...group.creditCards,
      ...group.loans,
    ]);

    expect(lines).toHaveLength(3);
    expect(lookupByKey).toHaveBeenCalledTimes(1);
    expect(lookupByKey).toHaveBeenCalledWith('user-1', [
      { type: 'account', id: 'acc-1' },
      { type: 'card', id: 'card-1' },
      { type: 'loan', id: 'loan-1' },
    ]);
    expect(lines.map((line) => line.entity)).toEqual([
      { id: 'acc-1', kind: 'account' },
      { id: 'card-1', kind: 'card' },
      { id: 'loan-1', kind: 'loan' },
    ]);
    expect(balanceSheet.global.netWorth).toBe('989');
  });

  it('keeps the line without entity when the product is gone', async () => {
    loadPositions.mockResolvedValue({
      institutions: [],
      accounts: [
        { id: 'acc-1', institutionId: null, currency: 'DOP', balance: 10 },
      ],
      cardBalances: [],
      loans: [],
    });

    const balanceSheet = await createService().getBalanceSheet('user-1');

    expect(
      balanceSheet.breakdown.byCurrency[0]?.accounts[0]?.entity,
    ).toBeNull();
  });
});
