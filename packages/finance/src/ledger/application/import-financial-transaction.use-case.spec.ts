import {
  ImportFinancialTransactionUseCase,
  type ImportFinancialMovementInput,
} from './import-financial-transaction.use-case';

const movement: ImportFinancialMovementInput = {
  accountId: 'account-1',
  importReference: 'signal-1',
  amount: 100,
  currency: 'DOP',
  merchant: null,
  description: 'Transferencia',
  transactionDate: new Date('2026-11-01T00:00:00.000Z'),
  status: 'CONFIRMED',
};

type TransferLegCommand = {
  type?: string;
  legRole?: string;
  categoryId?: string | null;
  cardId?: string;
  transferGroupId?: string;
};

function setup() {
  const useCase = new ImportFinancialTransactionUseCase(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const execute = jest
    .spyOn(useCase, 'execute')
    .mockResolvedValue({ id: 'transaction-1' } as never);
  return { useCase, execute };
}

describe('ImportFinancialTransactionUseCase unpaired transfers', () => {
  it('marks a transfer out as a source leg with a new group and no category', async () => {
    const { useCase, execute } = setup();

    await useCase.executeUnpairedTransfer('user-1', {
      ...movement,
      type: 'DEBIT',
    });

    const command = execute.mock.calls[0][1] as TransferLegCommand;
    expect(command).toMatchObject({
      type: 'DEBIT',
      legRole: 'SOURCE',
      categoryId: null,
    });
    expect(command.cardId).toBeUndefined();
    expect(typeof command.transferGroupId).toBe('string');
    expect(command.transferGroupId).not.toHaveLength(0);
  });

  it('marks a transfer in as a destination leg', async () => {
    const { useCase, execute } = setup();

    await useCase.executeUnpairedTransfer('user-1', {
      ...movement,
      type: 'CREDIT',
    });

    const command = execute.mock.calls[0][1] as TransferLegCommand;
    expect(command).toMatchObject({
      legRole: 'DESTINATION',
      categoryId: null,
    });
  });

  it('gives each unpaired leg its own transfer group', async () => {
    const { useCase, execute } = setup();

    await useCase.executeUnpairedTransfer('user-1', {
      ...movement,
      type: 'DEBIT',
    });
    await useCase.executeUnpairedTransfer('user-1', {
      ...movement,
      type: 'CREDIT',
    });

    const first = execute.mock.calls[0][1] as TransferLegCommand;
    const second = execute.mock.calls[1][1] as TransferLegCommand;
    expect(first.transferGroupId).not.toBe(second.transferGroupId);
  });

  it('records the FX rate date and base rate in the imported metadata', async () => {
    const repo = {
      findAccountById: jest
        .fn()
        .mockResolvedValue({ id: 'account-1', currency: 'DOP' }),
      createImportedTransaction: jest
        .fn()
        .mockResolvedValue({ id: 'transaction-1' }),
    };
    const resolveAmounts = {
      execute: jest.fn().mockResolvedValue({
        amount: 59.99,
        currency: 'USD',
        ledgerAmount: 3627.09,
        ledgerCurrency: 'DOP',
        amountBaseCurrency: 3627.09,
        exchangeRate: 60.4617,
        exchangeRateDate: '2026-11-06',
        baseExchangeRate: 60.4617,
        baseExchangeRateDate: '2026-11-06',
      }),
    };
    const useCase = new ImportFinancialTransactionUseCase(
      repo as never,
      resolveAmounts as never,
      { execute: jest.fn().mockResolvedValue('DOP') },
      { wake: jest.fn() },
      { resolve: jest.fn() } as never,
    );

    await useCase.execute('user-1', {
      ...movement,
      currency: 'USD',
      aiMetadata: { signalId: 'signal-1' },
    });

    expect(repo.createImportedTransaction).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        aiMetadata: expect.objectContaining({
          signalId: 'signal-1',
          exchangeRateDate: '2026-11-06',
          baseExchangeRate: 60.4617,
          baseExchangeRateDate: '2026-11-06',
        }),
      }),
    );
  });
});
