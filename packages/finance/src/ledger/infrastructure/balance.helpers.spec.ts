import {
  adjustBudgetSpent,
  applyBalanceForTransaction,
  signedAmount,
} from './balance.helpers';

describe('balance.helpers', () => {
  it('signedAmount maps CREDIT positive and DEBIT negative', () => {
    expect(signedAmount('CREDIT', 100)).toBe(100);
    expect(signedAmount('DEBIT', 50)).toBe(-50);
    expect(signedAmount('DEBIT', -50)).toBe(-50);
  });

  it('applyBalanceForTransaction updates only account for accountId-only', async () => {
    const tx = {
      finAccount: {
        update: jest.fn(() => Promise.resolve({})),
      },
      finCardBalance: {
        findFirst: jest.fn(() => Promise.resolve(null)),
        create: jest.fn(() => Promise.resolve({})),
        update: jest.fn(() => Promise.resolve({})),
      },
    };

    await applyBalanceForTransaction(tx as never, {
      accountId: 'acc-1',
      cardId: null,
      currency: 'DOP',
      type: 'DEBIT',
      amount: 25,
    });

    expect(tx.finAccount.update).toHaveBeenCalledWith({
      where: { id: 'acc-1' },
      data: { balance: { increment: -25 } },
    });
    expect(tx.finCardBalance.create).not.toHaveBeenCalled();
  });

  it('applyBalanceForTransaction updates FinCardBalance for CREDIT cards', async () => {
    const tx = {
      finAccount: {
        update: jest.fn(() => Promise.resolve({})),
      },
      finCardBalance: {
        findFirst: jest.fn(() => Promise.resolve(null)),
        create: jest.fn(() => Promise.resolve({})),
        update: jest.fn(() => Promise.resolve({})),
      },
    };

    await applyBalanceForTransaction(tx as never, {
      accountId: null,
      cardId: 'card-1',
      cardType: 'CREDIT',
      derivedAccountId: null,
      currency: 'USD',
      type: 'DEBIT',
      amount: 40,
    });

    expect(tx.finAccount.update).not.toHaveBeenCalled();
    expect(tx.finCardBalance.create).toHaveBeenCalledWith({
      data: { cardId: 'card-1', currency: 'USD', balance: -40 },
    });
  });

  it('applyBalanceForTransaction updates underlying account for DEBIT cards', async () => {
    const tx = {
      finAccount: {
        update: jest.fn(() => Promise.resolve({})),
      },
      finCardBalance: {
        findFirst: jest.fn(() => Promise.resolve(null)),
        create: jest.fn(() => Promise.resolve({})),
        update: jest.fn(() => Promise.resolve({})),
      },
    };

    await applyBalanceForTransaction(tx as never, {
      accountId: null,
      cardId: 'card-debit',
      cardType: 'DEBIT',
      derivedAccountId: 'acc-linked',
      currency: 'DOP',
      type: 'DEBIT',
      amount: 15,
    });

    expect(tx.finAccount.update).toHaveBeenCalledWith({
      where: { id: 'acc-linked' },
      data: { balance: { increment: -15 } },
    });
    expect(tx.finCardBalance.create).not.toHaveBeenCalled();
  });

  it('applyBalanceForTransaction reverses with direction -1', async () => {
    const tx = {
      finAccount: {
        update: jest.fn(() => Promise.resolve({})),
      },
      finCardBalance: {
        findFirst: jest.fn(() => Promise.resolve(null)),
        create: jest.fn(() => Promise.resolve({})),
        update: jest.fn(() => Promise.resolve({})),
      },
    };

    await applyBalanceForTransaction(tx as never, {
      accountId: 'acc-1',
      currency: 'DOP',
      type: 'CREDIT',
      amount: 10,
      direction: -1,
    });

    expect(tx.finAccount.update).toHaveBeenCalledWith({
      where: { id: 'acc-1' },
      data: { balance: { increment: -10 } },
    });
  });

  it('adjustBudgetSpent only applies to DEBIT with category', async () => {
    const tx = {
      finBudget: {
        findMany: jest.fn(() =>
          Promise.resolve([
            {
              id: 'b1',
              amountSpent: 0,
              amountLimit: 100,
              alertThresholdPct: 80,
            },
          ]),
        ),
        update: jest.fn(() =>
          Promise.resolve({
            id: 'b1',
            amountSpent: 40,
            amountLimit: 100,
            alertThresholdPct: 80,
          }),
        ),
      },
    };

    const empty = await adjustBudgetSpent(tx as never, {
      userId: 'u1',
      categoryId: null,
      type: 'DEBIT',
      amountBaseCurrency: 40,
      transactionDate: new Date('2026-07-01'),
    });
    expect(empty).toEqual([]);

    const credit = await adjustBudgetSpent(tx as never, {
      userId: 'u1',
      categoryId: 'c1',
      type: 'CREDIT',
      amountBaseCurrency: 40,
      transactionDate: new Date('2026-07-01'),
    });
    expect(credit).toEqual([]);

    const snaps = await adjustBudgetSpent(tx as never, {
      userId: 'u1',
      categoryId: 'c1',
      type: 'DEBIT',
      amountBaseCurrency: 40,
      transactionDate: new Date('2026-07-15T12:00:00Z'),
    });
    expect(snaps).toEqual([
      {
        budgetId: 'b1',
        amountSpent: 40,
        amountLimit: 100,
        alertThresholdPct: 80,
      },
    ]);
    expect(tx.finBudget.update).toHaveBeenCalled();
  });
});
