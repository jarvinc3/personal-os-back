import { resolveLedgerTargetFromHints } from './resolve-ledger-target-from-hints';

describe('resolveLedgerTargetFromHints', () => {
  const accounts = [
    { id: 'acc-1', accountNumberLast4: '5678' },
    { id: 'acc-2', accountNumberLast4: '0000' },
  ];
  const cards = [
    { id: 'card-1', lastFour: '9999' },
    { id: 'card-2', lastFour: '1234' },
  ];

  it('imports a unique last-four card match', () => {
    expect(
      resolveLedgerTargetFromHints({
        instrumentHint: 'CARD',
        lastFourHint: '9999',
        accountNumberHint: null,
        accounts,
        cards,
      }),
    ).toEqual({ kind: 'unique', cardId: 'card-1' });
  });

  it('matches ACCOUNT by lastFourHint suffix when accountNumberHint is missing', () => {
    expect(
      resolveLedgerTargetFromHints({
        instrumentHint: 'ACCOUNT',
        lastFourHint: '5678',
        accountNumberHint: null,
        accounts,
        cards,
      }),
    ).toEqual({ kind: 'unique', accountId: 'acc-1' });
  });

  it('matches ACCOUNT by full account number', () => {
    expect(
      resolveLedgerTargetFromHints({
        instrumentHint: 'ACCOUNT',
        lastFourHint: null,
        accountNumberHint: '001122335678',
        accounts,
        cards,
      }),
    ).toEqual({ kind: 'unique', accountId: 'acc-1' });
  });

  it('matches ACCOUNT by masked last-four against the account suffix', () => {
    expect(
      resolveLedgerTargetFromHints({
        instrumentHint: 'ACCOUNT',
        lastFourHint: null,
        accountNumberHint: '5678',
        accounts,
        cards,
      }),
    ).toEqual({ kind: 'unique', accountId: 'acc-1' });
  });

  it('is ambiguous when two accounts share the same suffix', () => {
    expect(
      resolveLedgerTargetFromHints({
        instrumentHint: 'ACCOUNT',
        lastFourHint: null,
        accountNumberHint: '1111',
        accounts: [
          { id: 'acc-a', accountNumberLast4: '1111' },
          { id: 'acc-b', accountNumberLast4: '1111' },
        ],
        cards,
      }),
    ).toEqual({ kind: 'ambiguous', candidateCount: 2 });
  });

  it('does not match CARD using an account number', () => {
    expect(
      resolveLedgerTargetFromHints({
        instrumentHint: 'CARD',
        lastFourHint: '5678',
        accountNumberHint: '001122335678',
        accounts,
        cards,
      }),
    ).toEqual({ kind: 'none' });
  });

  it('is ambiguous for ACCOUNT without hints when several accounts exist', () => {
    expect(
      resolveLedgerTargetFromHints({
        instrumentHint: 'ACCOUNT',
        lastFourHint: null,
        accountNumberHint: null,
        accounts,
        cards,
      }),
    ).toEqual({ kind: 'ambiguous', candidateCount: 2 });
  });

  it('returns none when last four does not match a card', () => {
    expect(
      resolveLedgerTargetFromHints({
        instrumentHint: 'CARD',
        lastFourHint: '0000',
        accountNumberHint: null,
        accounts,
        cards,
      }),
    ).toEqual({ kind: 'none' });
  });

  it('matches the card when last four is present without an instrument hint', () => {
    expect(
      resolveLedgerTargetFromHints({
        instrumentHint: null,
        lastFourHint: '1234',
        accountNumberHint: null,
        accounts,
        cards,
      }),
    ).toEqual({ kind: 'unique', cardId: 'card-2' });
  });

  it('matches the account when only accountNumberHint is present without an instrument hint', () => {
    expect(
      resolveLedgerTargetFromHints({
        instrumentHint: null,
        lastFourHint: null,
        accountNumberHint: '5678',
        accounts,
        cards,
      }),
    ).toEqual({ kind: 'unique', accountId: 'acc-1' });
  });

  it('does not mix a card lastFour with an account suffix when there is no instrument hint', () => {
    expect(
      resolveLedgerTargetFromHints({
        instrumentHint: null,
        lastFourHint: '1234',
        accountNumberHint: null,
        accounts: [{ id: 'acc-same-suffix', accountNumberLast4: '1234' }],
        cards,
      }),
    ).toEqual({ kind: 'unique', cardId: 'card-2' });
  });

  it('matches the only destination of the institution without last four', () => {
    expect(
      resolveLedgerTargetFromHints({
        instrumentHint: null,
        lastFourHint: null,
        accountNumberHint: null,
        accounts: [{ id: 'acc-only', accountNumberLast4: null }],
        cards: [],
      }),
    ).toEqual({ kind: 'unique', accountId: 'acc-only' });
  });

  it('uses the institution default account only when there are no digits', () => {
    const many = [
      {
        id: 'acc-1',
        accountNumberLast4: '1111',
        isDefaultForInstitution: true,
      },
      {
        id: 'acc-2',
        accountNumberLast4: '2222',
        isDefaultForInstitution: false,
      },
    ];
    expect(
      resolveLedgerTargetFromHints({
        instrumentHint: 'ACCOUNT',
        lastFourHint: null,
        accountNumberHint: null,
        accounts: many,
        cards: [],
        allowDefaultAccount: true,
      }),
    ).toEqual({ kind: 'unique', accountId: 'acc-1' });

    expect(
      resolveLedgerTargetFromHints({
        instrumentHint: 'ACCOUNT',
        lastFourHint: null,
        accountNumberHint: '9999',
        accounts: many,
        cards: [],
        allowDefaultAccount: true,
      }),
    ).toEqual({ kind: 'none' });
  });
});
