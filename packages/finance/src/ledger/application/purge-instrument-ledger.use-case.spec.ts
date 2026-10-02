import type { FinanceOutboxDispatcher } from '../../events/infrastructure/finance-outbox.dispatcher';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';
import { PurgeInstrumentLedgerUseCase } from './purge-instrument-ledger.use-case';

describe('PurgeInstrumentLedgerUseCase', () => {
  const purgeLedgerForAccount = jest.fn();
  const purgeLedgerForCard = jest.fn();
  const processBatch = jest.fn();

  const repo = {
    purgeLedgerForAccount,
    purgeLedgerForCard,
  } as unknown as LedgerRepositoryPort;

  const outboxDispatcher = {
    processBatch,
  } as unknown as FinanceOutboxDispatcher;

  const useCase = new PurgeInstrumentLedgerUseCase(repo, outboxDispatcher);

  beforeEach(() => {
    jest.clearAllMocks();
    purgeLedgerForAccount.mockResolvedValue({ count: 1 });
    purgeLedgerForCard.mockResolvedValue({ count: 1 });
  });

  it('purges an account ledger and wakes the outbox', async () => {
    await useCase.forAccount('user-1', 'acc-1');
    expect(purgeLedgerForAccount).toHaveBeenCalledWith('user-1', 'acc-1');
    expect(processBatch).toHaveBeenCalled();
  });

  it('purges a card ledger and wakes the outbox', async () => {
    await useCase.forCard('user-1', 'card-1');
    expect(purgeLedgerForCard).toHaveBeenCalledWith('user-1', 'card-1');
    expect(processBatch).toHaveBeenCalled();
  });
});
