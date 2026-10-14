import {
  computeExpectedBalances,
  hasDrift,
  movementDeltaCents,
  movementTarget,
  type IntegrityCard,
  type IntegrityMovement,
} from './expected-balance';

const CARDS: IntegrityCard[] = [
  { id: 'card-credit', type: 'CREDIT', accountId: null },
  { id: 'card-debit', type: 'DEBIT', accountId: 'acc-1' },
];

const CARD_BY_ID = new Map(CARDS.map((card) => [card.id, card]));

function movement(
  overrides: Partial<IntegrityMovement> & { type: IntegrityMovement['type'] },
): IntegrityMovement {
  return {
    accountId: null,
    cardId: null,
    ledgerAmountCents: 0,
    ledgerCurrency: 'DOP',
    ...overrides,
  };
}

type LedgerState = {
  accounts: Record<string, number>;
  cards: Record<string, number>;
};

/** Stored state after applying one movement, the way the ledger does. */
function applyMovement(
  state: LedgerState,
  entry: IntegrityMovement,
): LedgerState {
  const target = movementTarget(entry, CARD_BY_ID);
  if (!target) {
    return state;
  }
  const delta = movementDeltaCents(entry);
  if (target.kind === 'account') {
    return {
      ...state,
      accounts: {
        ...state.accounts,
        [target.accountId]: (state.accounts[target.accountId] ?? 0) + delta,
      },
    };
  }
  const key = `${target.cardId}:${target.currency}`;
  return {
    ...state,
    cards: { ...state.cards, [key]: (state.cards[key] ?? 0) + delta },
  };
}

describe('expected balance (I1)', () => {
  it('classifies every movement type into the product the ledger moves', () => {
    expect(
      movementTarget(
        movement({
          type: 'DEBIT',
          accountId: 'acc-1',
          ledgerAmountCents: -100,
        }),
        CARD_BY_ID,
      ),
    ).toEqual({ kind: 'account', accountId: 'acc-1' });

    expect(
      movementTarget(
        movement({
          type: 'DEBIT',
          cardId: 'card-debit',
          ledgerAmountCents: -30,
        }),
        CARD_BY_ID,
      ),
    ).toEqual({ kind: 'account', accountId: 'acc-1' });

    expect(
      movementTarget(
        movement({
          type: 'DEBIT',
          cardId: 'card-credit',
          ledgerAmountCents: -60,
        }),
        CARD_BY_ID,
      ),
    ).toEqual({ kind: 'card', cardId: 'card-credit', currency: 'DOP' });

    expect(
      movementTarget(
        movement({
          type: 'ADJUSTMENT',
          cardId: 'card-debit',
          ledgerAmountCents: 12,
        }),
        CARD_BY_ID,
      ),
    ).toEqual({ kind: 'card', cardId: 'card-debit', currency: 'DOP' });
  });

  it('matches the stored balance after each step of a mixed sequence', () => {
    let state: LedgerState = {
      accounts: { 'acc-1': 0, 'acc-2': 0 },
      cards: { 'card-credit:DOP': 0 },
    };
    let movements: IntegrityMovement[] = [];
    const accountRows = [
      { id: 'acc-1', currency: 'DOP', balanceCents: 0 },
      { id: 'acc-2', currency: 'DOP', balanceCents: 0 },
    ];
    const cardBalanceRows = [
      {
        id: 'cb-1',
        cardId: 'card-credit',
        currency: 'DOP',
        balanceCents: 0,
      },
    ];

    const assertI1 = (): void => {
      const expected = computeExpectedBalances({
        accounts: accountRows.map((account) => ({
          ...account,
          balanceCents: state.accounts[account.id] ?? 0,
        })),
        cards: CARDS,
        cardBalances: cardBalanceRows.map((row) => ({
          ...row,
          balanceCents: state.cards[`${row.cardId}:${row.currency}`] ?? 0,
        })),
        movements,
      });
      expect(expected.accounts.every((account) => !hasDrift(account))).toBe(
        true,
      );
      expect(expected.cards.every((card) => !hasDrift(card))).toBe(true);
      for (const account of expected.accounts) {
        expect(account.expectedCents).toBe(account.storedCents);
      }
      for (const card of expected.cards) {
        expect(card.expectedCents).toBe(card.storedCents);
      }
    };

    const push = (entry: IntegrityMovement): void => {
      movements = [...movements, entry];
      state = applyMovement(state, entry);
      assertI1();
    };

    push(
      movement({ type: 'DEBIT', accountId: 'acc-1', ledgerAmountCents: -100 }),
    );
    push(
      movement({ type: 'CREDIT', accountId: 'acc-1', ledgerAmountCents: 500 }),
    );
    push(
      movement({
        type: 'DEBIT',
        cardId: 'card-credit',
        ledgerAmountCents: -60,
      }),
    );
    push(
      movement({
        type: 'CARD_PAYMENT',
        cardId: 'card-credit',
        ledgerAmountCents: 60,
      }),
    );
    push(
      movement({
        type: 'CARD_PAYMENT',
        accountId: 'acc-1',
        ledgerAmountCents: 20,
      }),
    );
    push(
      movement({ type: 'DEBIT', accountId: 'acc-1', ledgerAmountCents: -100 }),
    );
    push(
      movement({ type: 'CREDIT', accountId: 'acc-2', ledgerAmountCents: 100 }),
    );
    push(
      movement({ type: 'DEBIT', accountId: 'acc-1', ledgerAmountCents: -5 }),
    );
    push(
      movement({ type: 'DEBIT', cardId: 'card-debit', ledgerAmountCents: -30 }),
    );
    push(
      movement({
        type: 'ADJUSTMENT',
        accountId: 'acc-1',
        ledgerAmountCents: 12,
      }),
    );
    push(
      movement({
        type: 'ADJUSTMENT',
        cardId: 'card-credit',
        ledgerAmountCents: -8,
      }),
    );
    push(
      movement({ type: 'DEBIT', accountId: 'acc-1', ledgerAmountCents: -50 }),
    );

    // Reversing the first debit removes it from the confirmed set and undoes
    // its effect on the stored balance.
    movements = movements.slice(1);
    state = applyMovement(
      state,
      movement({ type: 'CREDIT', accountId: 'acc-1', ledgerAmountCents: 100 }),
    );
    assertI1();

    // A goal allocation never moves the account balance; nothing to add.
    expect(state.accounts['acc-1']).toBe(307);
    expect(state.accounts['acc-2']).toBe(100);
    expect(state.cards['card-credit:DOP']).toBe(-8);
  });

  it('ignores movements with no resolvable product', () => {
    const expected = computeExpectedBalances({
      accounts: [{ id: 'acc-1', currency: 'DOP', balanceCents: 0 }],
      cards: CARDS,
      cardBalances: [],
      movements: [
        movement({ type: 'DEBIT', ledgerAmountCents: -10 }),
        movement({
          type: 'DEBIT',
          cardId: 'ghost-card',
          ledgerAmountCents: -10,
        }),
      ],
    });
    expect(expected.accounts).toEqual([
      {
        accountId: 'acc-1',
        currency: 'DOP',
        storedCents: 0,
        expectedCents: 0,
      },
    ]);
  });

  it('reports a credit card currency with movements but no stored row', () => {
    const expected = computeExpectedBalances({
      accounts: [],
      cards: CARDS,
      cardBalances: [],
      movements: [
        movement({
          type: 'DEBIT',
          cardId: 'card-credit',
          ledgerAmountCents: -15,
          ledgerCurrency: 'USD',
        }),
      ],
    });
    expect(expected.cards).toEqual([
      {
        cardId: 'card-credit',
        currency: 'USD',
        balanceRowId: null,
        storedCents: 0,
        expectedCents: -15,
      },
    ]);
  });
});
