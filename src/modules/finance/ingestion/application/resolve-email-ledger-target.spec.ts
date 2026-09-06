import { resolveEmailLedgerTarget } from './resolve-email-ledger-target';

describe('resolveEmailLedgerTarget', () => {
  const accounts = [{ id: 'acc-1' }, { id: 'acc-2' }];
  const cards = [
    { id: 'card-1', lastFour: '9999' },
    { id: 'card-2', lastFour: '1234' },
  ];

  it('imports a unique last-four card match', () => {
    expect(
      resolveEmailLedgerTarget({
        instrumentHint: 'CARD',
        lastFourHint: '9999',
        accounts,
        cards,
      }),
    ).toEqual({ kind: 'unique', cardId: 'card-1' });
  });

  it('ignores lastFour on ACCOUNT and matches the only account', () => {
    expect(
      resolveEmailLedgerTarget({
        instrumentHint: 'ACCOUNT',
        lastFourHint: '0000',
        accounts: [{ id: 'acc-only' }],
        cards,
      }),
    ).toEqual({ kind: 'unique', accountId: 'acc-only' });
  });

  it('returns none when last four does not match a card', () => {
    expect(
      resolveEmailLedgerTarget({
        instrumentHint: 'CARD',
        lastFourHint: '0000',
        accounts,
        cards,
      }),
    ).toEqual({ kind: 'none' });
  });

  it('matches the card when last four is present without an instrument hint', () => {
    expect(
      resolveEmailLedgerTarget({
        instrumentHint: null,
        lastFourHint: '1234',
        accounts,
        cards,
      }),
    ).toEqual({ kind: 'unique', cardId: 'card-2' });
  });

  it('matches the only destination of the institution without last four', () => {
    expect(
      resolveEmailLedgerTarget({
        instrumentHint: null,
        lastFourHint: null,
        accounts: [{ id: 'acc-only' }],
        cards: [],
      }),
    ).toEqual({ kind: 'unique', accountId: 'acc-only' });
  });
});
