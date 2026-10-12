import {
  DELETION_MODEL,
  reversedMovements,
  toDeletionValues,
  type DeletionSnapshot,
} from './deletion-snapshot';

describe('toDeletionValues', () => {
  it('turns dates into ISO strings so the journal can store them', () => {
    const values = toDeletionValues({
      id: 'tx-1',
      transactionDate: new Date(Date.UTC(2026, 0, 2)),
    });

    expect(values.id).toBe('tx-1');
    expect(values.transactionDate).toBe('2026-01-02T00:00:00.000Z');
  });

  it('drops undefined fields', () => {
    expect(toDeletionValues({ id: 'a', note: undefined })).toEqual({ id: 'a' });
  });
});

describe('reversedMovements', () => {
  const snapshot: DeletionSnapshot = {
    rows: [
      { model: DELETION_MODEL.transaction, values: { id: 'tx-1' } },
      { model: DELETION_MODEL.transaction, values: { id: 'tx-2' } },
      { model: DELETION_MODEL.card, values: { id: 'card-1' } },
    ],
    ledgerReversed: ['tx-2'],
  };

  it('returns only the movements whose ledger effect was reversed', () => {
    expect(reversedMovements(snapshot).map((movement) => movement.id)).toEqual([
      'tx-2',
    ]);
  });

  it('returns nothing without a reversed list', () => {
    expect(reversedMovements({ rows: snapshot.rows })).toEqual([]);
  });
});
