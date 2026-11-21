import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AppEvents } from '@personal-os/core';
import { Prisma } from '@personal-os/database';
import {
  BASE_CURRENCY_CHANGED_CODE,
  CHANGE_BASE_CURRENCY_TIMEOUT_MS,
  ChangeBaseCurrencyUseCase,
} from './change-base-currency.use-case';

type MockPrisma = {
  module: { findUnique: jest.Mock };
  userModule: { findUnique: jest.Mock; update: jest.Mock };
  finTransaction: { findMany: jest.Mock; update: jest.Mock };
  finBudget: { findMany: jest.Mock; update: jest.Mock };
  $transaction: jest.Mock;
};

function buildPrisma(): MockPrisma {
  const prisma: MockPrisma = {
    module: { findUnique: jest.fn().mockResolvedValue({ id: 'mod-finance' }) },
    userModule: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'um-1',
        config: { baseCurrency: 'DOP', trackedCurrencies: ['USD', 'EUR'] },
      }),
      update: jest.fn(),
    },
    finTransaction: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'tx-usd',
          amount: 10,
          currency: 'USD',
          transactionDate: new Date('2026-08-10T12:00:00Z'),
          type: 'DEBIT',
          status: 'CONFIRMED',
          categoryId: 'cat-1',
        },
        {
          id: 'tx-dop',
          amount: 100,
          currency: 'DOP',
          transactionDate: new Date('2026-08-10T12:00:00Z'),
          type: 'DEBIT',
          status: 'CONFIRMED',
          categoryId: 'cat-1',
        },
      ]),
      update: jest.fn(),
    },
    finBudget: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'b-1',
          categoryId: 'cat-1',
          periodStart: new Date('2026-08-01'),
          periodEnd: new Date('2026-08-31'),
          amountLimit: 1000,
        },
      ]),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    (callback: (client: MockPrisma) => unknown) => callback(prisma),
  );
  return prisma;
}

describe('ChangeBaseCurrencyUseCase', () => {
  let prisma: MockPrisma;
  let getLedgerRate: jest.Mock;
  let emit: jest.Mock;

  const config = { get: jest.fn().mockReturnValue('DOP') };
  const createUseCase = () =>
    new ChangeBaseCurrencyUseCase(
      prisma as never,
      { getLedgerRate } as never,
      config as never,
      { emit } as never,
    );

  beforeEach(() => {
    prisma = buildPrisma();
    getLedgerRate = jest.fn();
    emit = jest.fn();
  });

  it('is a 200 no-op when the code equals the current base', async () => {
    const changeResult = await createUseCase().execute('user-1', 'DOP');

    expect(changeResult).toEqual({
      baseCurrency: 'DOP',
      previousBaseCurrency: 'DOP',
      rebasedTransactions: 0,
      rebasedBudgets: 0,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(getLedgerRate).not.toHaveBeenCalled();
  });

  it('rejects an invalid currency code before any query', async () => {
    await expect(
      createUseCase().execute('user-1', 'US'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('aborts with 400 and writes nothing when a rate is missing', async () => {
    getLedgerRate.mockResolvedValue({
      ok: false,
      code: 'RATE_UNAVAILABLE',
      message: 'missing',
      retryable: true,
    });

    await expect(
      createUseCase().execute('user-1', 'USD'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.finTransaction.update).not.toHaveBeenCalled();
  });

  it('aborts with 503 when the provider is unauthorized', async () => {
    getLedgerRate.mockResolvedValue({
      ok: false,
      code: 'PROVIDER_UNAUTHORIZED',
      message: 'FX provider unauthorized (HTTP 401)',
      retryable: false,
      providerStatus: 401,
    });

    await expect(
      createUseCase().execute('user-1', 'USD'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.finTransaction.update).not.toHaveBeenCalled();
  });

  it('rebases transactions, budgets and config in one transaction', async () => {
    getLedgerRate.mockResolvedValue({
      ok: true,
      rate: 0.5,
      source: 'cache',
    });

    const changeResult = await createUseCase().execute('user-1', 'USD');

    expect(changeResult).toEqual({
      baseCurrency: 'USD',
      previousBaseCurrency: 'DOP',
      rebasedTransactions: 2,
      rebasedBudgets: 1,
    });
    expect(prisma.finTransaction.update).toHaveBeenCalledWith({
      where: { id: 'tx-usd' },
      data: { amountBaseCurrency: new Prisma.Decimal(10) },
    });
    expect(prisma.finTransaction.update).toHaveBeenCalledWith({
      where: { id: 'tx-dop' },
      data: { amountBaseCurrency: new Prisma.Decimal(50) },
    });
    expect(prisma.finBudget.update).toHaveBeenCalledWith({
      where: { id: 'b-1' },
      data: {
        amountLimit: new Prisma.Decimal(500),
        amountSpent: new Prisma.Decimal(60),
      },
    });
    expect(prisma.userModule.update).toHaveBeenCalledWith({
      where: { id: 'um-1' },
      data: {
        config: expect.objectContaining({
          baseCurrency: 'USD',
          trackedCurrencies: ['DOP', 'EUR'],
        }),
      },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: CHANGE_BASE_CURRENCY_TIMEOUT_MS,
    });
    expect(emit).toHaveBeenCalledWith(AppEvents.MODULE_CONFIG_UPDATED, {
      userId: 'user-1',
      slug: 'finance',
    });
  });

  it('consulta una sola vez cada par de moneda y fecha', async () => {
    const sameDayPurchase = {
      amount: 10,
      currency: 'USD',
      transactionDate: new Date('2026-08-10T12:00:00Z'),
      type: 'DEBIT',
      status: 'CONFIRMED',
      categoryId: 'cat-1',
    };
    prisma.finTransaction.findMany.mockResolvedValue([
      { id: 'tx-1', ...sameDayPurchase },
      { id: 'tx-2', ...sameDayPurchase },
      { id: 'tx-3', ...sameDayPurchase },
    ]);
    getLedgerRate.mockResolvedValue({
      ok: true,
      rate: 0.5,
      source: 'cache',
    });

    await createUseCase().execute('user-1', 'EUR');

    expect(getLedgerRate).toHaveBeenCalledTimes(2);
    expect(getLedgerRate).toHaveBeenNthCalledWith(1, {
      from: 'USD',
      to: 'EUR',
      date: '2026-08-10',
    });
    expect(getLedgerRate).toHaveBeenNthCalledWith(2, {
      from: 'DOP',
      to: 'EUR',
      date: '2026-08-01',
    });
  });

  it('responde 409 si otra petición cambió la moneda base mientras calculaba', async () => {
    getLedgerRate.mockResolvedValue({
      ok: true,
      rate: 0.5,
      source: 'cache',
    });
    prisma.userModule.findUnique
      .mockResolvedValueOnce({
        id: 'um-1',
        config: { baseCurrency: 'DOP', trackedCurrencies: ['USD', 'EUR'] },
      })
      .mockResolvedValueOnce({
        id: 'um-1',
        config: { baseCurrency: 'EUR', trackedCurrencies: ['DOP', 'USD'] },
      });

    const conflictError = await createUseCase()
      .execute('user-1', 'USD')
      .catch((error: unknown) => error);

    expect(conflictError).toBeInstanceOf(ConflictException);
    expect((conflictError as ConflictException).getResponse()).toMatchObject({
      code: BASE_CURRENCY_CHANGED_CODE,
    });
    expect(prisma.finTransaction.update).not.toHaveBeenCalled();
    expect(prisma.finBudget.update).not.toHaveBeenCalled();
    expect(prisma.userModule.update).not.toHaveBeenCalled();
  });
});
