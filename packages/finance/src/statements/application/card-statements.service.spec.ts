import { NotFoundException } from '@nestjs/common';
import type { CardStatementSnapshotRow } from '../infrastructure/card-statements.repository';
import { CardStatementsService } from './card-statements.service';

const utc = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day));

function creditCard(overrides: Record<string, unknown> = {}) {
  return {
    id: 'card-1',
    statementClosingDay: 15,
    paymentDueDay: 5,
    balances: [{ currency: 'DOP', balance: 149000, creditLimit: 150000 }],
    transactions: [
      {
        type: 'DEBIT',
        status: 'CONFIRMED',
        ledgerAmount: 1000,
        ledgerCurrency: 'DOP',
        transactionDate: utc(2026, 1, 5),
      },
    ],
    ...overrides,
  };
}

function setup(card: unknown, statements: readonly unknown[] = []) {
  const repo = {
    findCreditCard: jest.fn(() => Promise.resolve(card)),
    listStatements: jest.fn(() => Promise.resolve(statements)),
    upsertStatement: jest.fn((snapshot: CardStatementSnapshotRow) =>
      Promise.resolve(snapshot),
    ),
    listCreditCardsToSync: jest.fn(() => Promise.resolve([])),
  };
  const ownership = {
    assertCardOwned: jest.fn(() => Promise.resolve({ id: 'card-1' })),
  };
  const service = new CardStatementsService(repo as never, ownership as never);
  return { repo, service };
}

describe('CardStatementsService', () => {
  it('syncs one snapshot per closed cycle with its due date', async () => {
    const { repo, service } = setup(creditCard());

    await service.syncCardStatements('card-1', utc(2026, 3, 20));

    expect(repo.upsertStatement).toHaveBeenCalledTimes(3);
    expect(repo.upsertStatement).toHaveBeenNthCalledWith(1, {
      cardId: 'card-1',
      currency: 'DOP',
      cycleStart: utc(2025, 12, 15),
      cycleEnd: utc(2026, 1, 15),
      dueDate: utc(2026, 2, 5),
      closingBalance: 1000,
      minimumPayment: 27.78,
      minimumSource: 'ESTIMATED',
      status: 'OVERDUE',
    });
    expect(repo.upsertStatement).toHaveBeenNthCalledWith(3, {
      cardId: 'card-1',
      currency: 'DOP',
      cycleStart: utc(2026, 2, 15),
      cycleEnd: utc(2026, 3, 15),
      dueDate: utc(2026, 4, 5),
      closingBalance: 1000,
      minimumPayment: 27.78,
      minimumSource: 'ESTIMATED',
      status: 'CLOSED',
    });
  });

  it('leaves the due date empty when the card has no payment day', async () => {
    const { repo, service } = setup(
      creditCard({ statementClosingDay: 15, paymentDueDay: null }),
    );

    await service.syncCardStatements('card-1', utc(2026, 1, 20));

    expect(repo.upsertStatement).toHaveBeenCalledWith(
      expect.objectContaining({ dueDate: null }),
    );
  });

  it('skips a card without a closing day', async () => {
    const { repo, service } = setup(creditCard({ statementClosingDay: null }));

    await service.syncCardStatements('card-1', utc(2026, 3, 20));

    expect(repo.upsertStatement).not.toHaveBeenCalled();
  });

  it('skips a currency without a credit limit', async () => {
    const { repo, service } = setup(
      creditCard({
        balances: [{ currency: 'DOP', balance: 149000, creditLimit: null }],
      }),
    );

    await service.syncCardStatements('card-1', utc(2026, 3, 20));

    expect(repo.upsertStatement).not.toHaveBeenCalled();
  });

  it('skips a currency that has no movements', async () => {
    const { repo, service } = setup(
      creditCard({
        balances: [
          { currency: 'DOP', balance: 149000, creditLimit: 150000 },
          { currency: 'USD', balance: 500, creditLimit: 1000 },
        ],
      }),
    );

    await service.syncCardStatements('card-1', utc(2026, 2, 20));

    expect(
      repo.upsertStatement.mock.calls.map((call) => call[0].currency),
    ).toEqual(['DOP', 'DOP']);
  });

  it('reports payments and status when listing statements', async () => {
    const { service } = setup(
      creditCard({
        transactions: [
          {
            type: 'DEBIT',
            status: 'CONFIRMED',
            ledgerAmount: 1000,
            ledgerCurrency: 'DOP',
            transactionDate: utc(2026, 1, 5),
          },
          {
            type: 'CREDIT',
            status: 'CONFIRMED',
            ledgerAmount: 1000,
            ledgerCurrency: 'DOP',
            transactionDate: utc(2026, 2, 20),
          },
        ],
      }),
      [
        {
          id: 'statement-1',
          currency: 'DOP',
          cycleStart: utc(2026, 1, 15),
          cycleEnd: utc(2026, 2, 15),
          dueDate: utc(2026, 3, 5),
          closingBalance: 1000,
        },
      ],
    );

    const statements = await service.listCardStatements(
      'user-1',
      'card-1',
      utc(2026, 3, 1),
    );

    expect(statements).toEqual([
      {
        id: 'statement-1',
        currency: 'DOP',
        cycleStart: utc(2026, 1, 15),
        cycleEnd: utc(2026, 2, 15),
        dueDate: utc(2026, 3, 5),
        closingBalance: '1000',
        minimumPayment: '27.78',
        minimumSource: 'ESTIMATED',
        paidAmount: '1000',
        remaining: '0',
        status: 'PAID',
      },
    ]);
  });

  it('fails when the card is missing', async () => {
    const { service } = setup(null);

    await expect(
      service.listCardStatements('user-1', 'card-1', utc(2026, 3, 1)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
