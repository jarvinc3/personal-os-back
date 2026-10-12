import type { FinanceOutboxDispatcher } from '../../events/infrastructure/finance-outbox.dispatcher';
import type { ResolveAmountsUseCase } from '../../fx/application/resolve-amounts.use-case';
import type { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import { CreateCardPaymentUseCase } from './create-card-payment.use-case';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';

function leg(id: string) {
  return {
    id,
    userId: 'user-1',
    accountId: 'acc-1',
    cardId: null,
    type: 'CARD_PAYMENT',
    amount: 100,
    ledgerAmount: 100,
    amountBaseCurrency: 100,
    currency: 'DOP',
    ledgerCurrency: 'DOP',
    exchangeRate: 1,
    merchant: null,
    description: null,
    notes: null,
    categoryId: null,
    status: 'CONFIRMED',
    source: 'MANUAL',
    transferGroupId: 'grp-1',
    linkedTransactionId: null,
    transactionDate: new Date('2026-08-01T12:00:00.000Z'),
    createdAt: new Date('2026-08-01T12:00:00.000Z'),
  };
}

function buildRepo(overrides: Partial<LedgerRepositoryPort> = {}) {
  return {
    findCardForPayment: jest.fn().mockResolvedValue({
      id: 'card-1',
      type: 'CREDIT',
      currencies: ['DOP', 'USD'],
    }),
    findAccountById: jest
      .fn()
      .mockResolvedValue({ id: 'acc-1', currency: 'DOP' }),
    createCardPayment: jest.fn().mockResolvedValue({
      transferGroupId: 'grp-1',
      debit: leg('d1'),
      credit: leg('c1'),
    }),
    ...overrides,
  } as unknown as LedgerRepositoryPort;
}

function buildUseCase(repo: LedgerRepositoryPort) {
  const resolveAmounts = {
    execute: jest.fn().mockResolvedValue({
      amount: 100,
      currency: 'DOP',
      ledgerAmount: 100,
      ledgerCurrency: 'DOP',
      amountBaseCurrency: 100,
      exchangeRate: 1,
    }),
  } as unknown as ResolveAmountsUseCase;
  const baseCurrency = {
    execute: jest.fn().mockResolvedValue('DOP'),
  } as unknown as ResolveUserBaseCurrencyUseCase;
  const outboxDispatcher = {
    processBatch: jest.fn(),
  } as unknown as FinanceOutboxDispatcher;
  return new CreateCardPaymentUseCase(
    repo,
    resolveAmounts,
    baseCurrency,
    outboxDispatcher,
  );
}

const command = {
  fromAccountId: 'acc-1',
  cardId: 'card-1',
  amount: 100,
  transactionDate: '2026-08-01T12:00:00.000Z',
};

describe('CreateCardPaymentUseCase', () => {
  it('rejects a debit card', async () => {
    const repo = buildRepo({
      findCardForPayment: jest.fn().mockResolvedValue({
        id: 'card-1',
        type: 'DEBIT',
        currencies: ['DOP'],
      }),
    });

    await expect(
      buildUseCase(repo).execute('user-1', command),
    ).rejects.toMatchObject({ response: { code: 'CARD_NOT_CREDIT' } });
  });

  it('rejects a currency the card does not have', async () => {
    const repo = buildRepo();

    await expect(
      buildUseCase(repo).execute('user-1', { ...command, currency: 'EUR' }),
    ).rejects.toMatchObject({ response: { code: 'CARD_CURRENCY_MISSING' } });
  });

  it('reports a missing card', async () => {
    const repo = buildRepo({
      findCardForPayment: jest.fn().mockResolvedValue(null),
    });

    await expect(
      buildUseCase(repo).execute('user-1', command),
    ).rejects.toMatchObject({ response: { code: 'CARD_NOT_FOUND' } });
  });

  it('creates the two legs', async () => {
    const createCardPayment = jest.fn().mockResolvedValue({
      transferGroupId: 'grp-1',
      debit: leg('d1'),
      credit: leg('c1'),
    });
    const repo = buildRepo({
      createCardPayment,
    });

    const paymentResult = await buildUseCase(repo).execute('user-1', command);

    expect(createCardPayment).toHaveBeenCalledTimes(1);
    expect(paymentResult).toMatchObject({ transferGroupId: 'grp-1' });
  });
});
