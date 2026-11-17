import {
  ImportCardPaymentUseCase,
  type ImportCardPaymentInput,
} from './import-card-payment.use-case';

const payment: ImportCardPaymentInput = {
  sourceAccountId: 'account-1',
  sourceAccountCurrency: 'DOP',
  cardId: 'card-1',
  amount: 2500,
  currency: 'DOP',
  transactionDate: new Date('2026-11-06T12:00:00.000Z'),
  externalReference: 'PAY-1',
  importReference: 'email-message-1',
  aiMetadata: { signalId: 'signal-1' },
  description: 'Pago de tarjeta',
  notes: null,
  status: 'CONFIRMED',
};

function setup() {
  const repo = {
    createImportedCardPayment: jest.fn().mockResolvedValue({
      kind: 'created',
      sourceTransactionId: 'transaction-1',
    }),
  };
  const resolveAmounts = {
    execute: jest
      .fn()
      .mockResolvedValueOnce({
        amount: 2500,
        currency: 'DOP',
        ledgerAmount: 2500,
        ledgerCurrency: 'DOP',
        amountBaseCurrency: 2500,
        exchangeRate: 1,
        exchangeRateDate: '2026-11-06',
        baseExchangeRate: 1,
        baseExchangeRateDate: '2026-11-06',
      })
      .mockResolvedValueOnce({
        amount: 2500,
        currency: 'DOP',
        ledgerAmount: 2500,
        ledgerCurrency: 'DOP',
        amountBaseCurrency: 2500,
        exchangeRate: 1,
        exchangeRateDate: '2026-11-07',
        baseExchangeRate: 1,
        baseExchangeRateDate: '2026-11-07',
      }),
  };
  const relay = { wake: jest.fn() };
  const useCase = new ImportCardPaymentUseCase(
    repo as never,
    resolveAmounts as never,
    { execute: jest.fn().mockResolvedValue('DOP') },
    relay,
  );
  return { useCase, repo, relay };
}

describe('ImportCardPaymentUseCase', () => {
  it('records the source and destination rate dates in the command metadata', async () => {
    const { useCase, repo } = setup();

    await useCase.execute('user-1', payment);

    expect(repo.createImportedCardPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        command: expect.objectContaining({
          aiMetadata: expect.objectContaining({
            signalId: 'signal-1',
            exchangeRateDate: '2026-11-06',
            baseExchangeRateDate: '2026-11-06',
            destinationExchangeRateDate: '2026-11-07',
            destinationBaseExchangeRateDate: '2026-11-07',
          }),
        }),
      }),
    );
  });
});
