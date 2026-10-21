import { BadRequestException } from '@nestjs/common';
import type {
  CardLedgerContext,
  LedgerRepositoryPort,
} from './ports/ledger.repository.port';
import { resolveLedgerCurrencyForTarget } from './resolve-ledger-currency';

function buildRepo(input: {
  accountCurrency?: string;
  cardContext?: CardLedgerContext | null;
}) {
  const findAccountById = jest
    .fn()
    .mockResolvedValue(
      input.accountCurrency
        ? { id: 'acc-1', currency: input.accountCurrency }
        : null,
    );
  const findCardLedgerContext = jest
    .fn()
    .mockResolvedValue(input.cardContext ?? null);
  return {
    findAccountById,
    findCardLedgerContext,
    repo: {
      findAccountById,
      findCardLedgerContext,
    } as unknown as LedgerRepositoryPort,
  };
}

describe('resolveLedgerCurrencyForTarget', () => {
  it('uses the account currency', async () => {
    const { repo } = buildRepo({ accountCurrency: 'DOP' });
    await expect(
      resolveLedgerCurrencyForTarget(repo, 'user-1', 'acc-1', undefined, 'USD'),
    ).resolves.toBe('DOP');
  });

  it('converts a foreign purchase to the single currency of the card', async () => {
    const { repo } = buildRepo({
      cardContext: { cardType: 'CREDIT', accountId: null, currencies: ['DOP'] },
    });
    await expect(
      resolveLedgerCurrencyForTarget(
        repo,
        'user-1',
        undefined,
        'card-1',
        'USD',
      ),
    ).resolves.toBe('DOP');
  });

  it('keeps the movement currency when the card declares it', async () => {
    const { repo } = buildRepo({
      cardContext: {
        cardType: 'CREDIT',
        accountId: null,
        currencies: ['DOP', 'USD'],
      },
    });
    await expect(
      resolveLedgerCurrencyForTarget(
        repo,
        'user-1',
        undefined,
        'card-1',
        'USD',
      ),
    ).resolves.toBe('USD');
  });

  it('uses the linked account for a debit card', async () => {
    const { repo } = buildRepo({
      accountCurrency: 'DOP',
      cardContext: { cardType: 'DEBIT', accountId: 'acc-1', currencies: [] },
    });
    await expect(
      resolveLedgerCurrencyForTarget(
        repo,
        'user-1',
        undefined,
        'card-1',
        'USD',
      ),
    ).resolves.toBe('DOP');
  });

  it('keeps today behaviour for a card without balances', async () => {
    const { repo } = buildRepo({
      cardContext: { cardType: 'CREDIT', accountId: null, currencies: [] },
    });
    await expect(
      resolveLedgerCurrencyForTarget(
        repo,
        'user-1',
        undefined,
        'card-1',
        'USD',
      ),
    ).resolves.toBe('USD');
  });

  it('rejects a currency no declared currency covers when the card has several', async () => {
    const { repo } = buildRepo({
      cardContext: {
        cardType: 'CREDIT',
        accountId: null,
        currencies: ['DOP', 'EUR'],
      },
    });
    await expect(
      resolveLedgerCurrencyForTarget(
        repo,
        'user-1',
        undefined,
        'card-1',
        'USD',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
