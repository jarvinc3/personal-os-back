import {
  descriptionSimilarity,
  matchStatementLines,
  type LedgerMovementInput,
  type StatementLineInput,
} from './statement-line-matching';

const utc = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day));

function line(overrides: Partial<StatementLineInput> = {}): StatementLineInput {
  return {
    id: 'line-1',
    date: utc(2026, 9, 2),
    description: 'SUPERMERCADO NACIONAL SRL',
    amount: 4512.3,
    currency: 'DOP',
    type: 'DEBIT',
    reference: null,
    ...overrides,
  };
}

function movement(
  overrides: Partial<LedgerMovementInput> = {},
): LedgerMovementInput {
  return {
    id: 'mov-1',
    transactionDate: utc(2026, 9, 2),
    description: 'Supermercado Nacional',
    merchant: null,
    amount: 4512.3,
    currency: 'DOP',
    type: 'DEBIT',
    legRole: null,
    externalReference: null,
    ...overrides,
  };
}

describe('descriptionSimilarity', () => {
  it('ignores accents and word order', () => {
    expect(
      descriptionSimilarity('Farmacia Los Hidalgos', 'LOS HIDALGOS FARMACIA'),
    ).toBe(1);
  });

  it('is low for unrelated descriptions', () => {
    expect(
      descriptionSimilarity('Netflix', 'Supermercado La Sirena'),
    ).toBeLessThan(0.2);
  });
});

describe('matchStatementLines', () => {
  it('matches on amount, date and similar description', () => {
    const reconciliation = matchStatementLines({
      lines: [line()],
      movements: [movement()],
    });

    expect(reconciliation.matches).toEqual([
      { lineId: 'line-1', transactionId: 'mov-1', similarity: 0.8 },
    ]);
    expect(reconciliation.missingLineIds).toEqual([]);
    expect(reconciliation.extraTransactionIds).toEqual([]);
  });

  it('prefers the bank reference even days apart and with other text', () => {
    const reconciliation = matchStatementLines({
      lines: [line({ reference: 'REF-992001' })],
      movements: [
        movement({
          id: 'mov-ref',
          transactionDate: utc(2026, 9, 20),
          description: 'Pago POS',
          externalReference: 'ref-992001',
        }),
      ],
    });

    expect(reconciliation.matches).toEqual([
      { lineId: 'line-1', transactionId: 'mov-ref', similarity: 1 },
    ]);
  });

  it('leaves a line missing outside the three day window', () => {
    const reconciliation = matchStatementLines({
      lines: [line()],
      movements: [movement({ transactionDate: utc(2026, 9, 10) })],
    });

    expect(reconciliation.matches).toEqual([]);
    expect(reconciliation.missingLineIds).toEqual(['line-1']);
    expect(reconciliation.extraTransactionIds).toEqual(['mov-1']);
  });

  it('leaves a line missing when the amount differs', () => {
    const reconciliation = matchStatementLines({
      lines: [line()],
      movements: [movement({ amount: 4512.31 })],
    });

    expect(reconciliation.matches).toEqual([]);
    expect(reconciliation.missingLineIds).toEqual(['line-1']);
  });

  it('leaves a line missing when the text does not look alike', () => {
    const reconciliation = matchStatementLines({
      lines: [line({ description: 'COLEGIO SANTO TOMAS' })],
      movements: [movement({ description: 'Pago POS comercio' })],
    });

    expect(reconciliation.matches).toEqual([]);
    expect(reconciliation.missingLineIds).toEqual(['line-1']);
  });

  it('never reuses one movement for two lines', () => {
    const reconciliation = matchStatementLines({
      lines: [line({ id: 'line-1' }), line({ id: 'line-2' })],
      movements: [movement()],
    });

    expect(reconciliation.matches).toEqual([
      { lineId: 'line-1', transactionId: 'mov-1', similarity: 0.8 },
    ]);
    expect(reconciliation.missingLineIds).toEqual(['line-2']);
  });

  it('reports movements absent from the statement', () => {
    const reconciliation = matchStatementLines({
      lines: [line()],
      movements: [
        movement(),
        movement({
          id: 'mov-extra',
          transactionDate: utc(2026, 9, 4),
          amount: 100,
          description: 'NETFLIX.COM',
        }),
      ],
    });

    expect(reconciliation.extraTransactionIds).toEqual(['mov-extra']);
  });

  it('does not match a debit line against a credit movement', () => {
    const reconciliation = matchStatementLines({
      lines: [line()],
      movements: [movement({ type: 'CREDIT' })],
    });

    expect(reconciliation.matches).toEqual([]);
    expect(reconciliation.missingLineIds).toEqual(['line-1']);
  });

  it('matches a debit line with the source leg of a transfer', () => {
    const reconciliation = matchStatementLines({
      lines: [line({ description: 'TRANSFERENCIA A ALTICE' })],
      movements: [
        movement({
          description: 'Transferencia Altice',
          type: 'TRANSFER',
          legRole: 'SOURCE',
        }),
      ],
    });

    expect(reconciliation.matches).toHaveLength(1);
  });

  it('matches a credit card payment with a credit line', () => {
    const reconciliation = matchStatementLines({
      lines: [
        line({
          description: 'PAGO TARJETA BHD',
          amount: 10000,
          type: 'CREDIT',
        }),
      ],
      movements: [
        movement({
          description: 'Pago tarjeta BHD',
          amount: 10000,
          type: 'CARD_PAYMENT',
        }),
      ],
    });

    expect(reconciliation.matches).toHaveLength(1);
  });
});
