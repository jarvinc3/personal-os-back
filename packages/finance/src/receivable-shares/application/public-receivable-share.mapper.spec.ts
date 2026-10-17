import {
  mapPublicReceivableShare,
  type PublicReceivableShareRow,
} from './public-receivable-share.mapper';
import { receivableShareItemRef } from './receivable-share-token';

type ReceivableRow = PublicReceivableShareRow['items'][number]['receivable'];

function receivable(overrides: Partial<ReceivableRow> = {}): ReceivableRow {
  return {
    id: 'rec-1',
    description: 'Préstamo celular',
    notes: null,
    amount: 8500,
    paidAmount: 3000,
    currency: 'DOP',
    status: 'PARTIAL',
    dueDate: new Date('2026-10-30T00:00:00.000Z'),
    createdAt: new Date('2026-09-12T00:00:00.000Z'),
    payments: [
      { paidAt: new Date('2026-10-10T00:00:00.000Z'), amount: 2000 },
      { paidAt: new Date('2026-09-25T00:00:00.000Z'), amount: 1000 },
    ],
    ...overrides,
  };
}

function shareRow(
  overrides: Partial<PublicReceivableShareRow> = {},
): PublicReceivableShareRow {
  return {
    id: 'share-1',
    debtorName: 'Carlos Méndez',
    updatedAt: new Date('2026-10-16T19:30:00.000Z'),
    user: { fullName: 'Jarvin Collado', timezone: 'America/Santo_Domingo' },
    items: [{ receivable: receivable() }],
    ...overrides,
  };
}

describe('mapPublicReceivableShare', () => {
  it('maps the share and its single currency total', () => {
    const mapped = mapPublicReceivableShare(shareRow());

    expect(mapped.ownerFirstName).toBe('Jarvin');
    expect(mapped.debtorName).toBe('Carlos Méndez');
    expect(mapped.totalsByCurrency).toEqual([
      { currency: 'DOP', amount: '8500', paid: '3000', pending: '5500' },
    ]);
    expect(mapped.items).toHaveLength(1);
    expect(mapped.items[0]).toMatchObject({
      concept: 'Préstamo celular',
      amount: '8500',
      paid: '3000',
      pending: '5500',
      currency: 'DOP',
      status: 'PARTIAL',
    });
    expect(mapped.items[0].payments).toEqual([
      { paidAt: new Date('2026-10-10T00:00:00.000Z'), amount: '2000' },
      { paidAt: new Date('2026-09-25T00:00:00.000Z'), amount: '1000' },
    ]);
  });

  it('never converts: one total line per currency', () => {
    const mapped = mapPublicReceivableShare(
      shareRow({
        items: [
          { receivable: receivable() },
          {
            receivable: receivable({
              id: 'rec-2',
              currency: 'USD',
              amount: 400,
              paidAmount: 100,
              status: 'PENDING',
            }),
          },
        ],
      }),
    );

    expect(mapped.totalsByCurrency).toEqual([
      { currency: 'DOP', amount: '8500', paid: '3000', pending: '5500' },
      { currency: 'USD', amount: '400', paid: '100', pending: '300' },
    ]);
    expect(mapped.items.map((item) => item.currency)).toEqual(['DOP', 'USD']);
  });

  it('hides cancelled and written-off receivables', () => {
    const mapped = mapPublicReceivableShare(
      shareRow({
        items: [
          { receivable: receivable({ status: 'CANCELLED' }) },
          {
            receivable: receivable({ id: 'rec-2', status: 'WRITTEN_OFF' }),
          },
          { receivable: receivable({ id: 'rec-3' }) },
        ],
      }),
    );

    expect(mapped.items).toHaveLength(1);
    expect(mapped.items[0].ref).toBe(
      receivableShareItemRef('share-1', 'rec-3'),
    );
  });

  it('orders items by creation date, oldest first', () => {
    const mapped = mapPublicReceivableShare(
      shareRow({
        items: [
          {
            receivable: receivable({
              id: 'rec-2',
              createdAt: new Date('2026-10-05T00:00:00.000Z'),
            }),
          },
          { receivable: receivable({ id: 'rec-1' }) },
        ],
      }),
    );

    expect(mapped.items[0].concept).toBe('Préstamo celular');
    expect(mapped.items).toHaveLength(2);
  });

  it('leaks no internal ids, accounts, transactions or the owner email', () => {
    const payload = JSON.stringify(mapPublicReceivableShare(shareRow()));

    for (const forbidden of [
      'share-1',
      'rec-1',
      'accountId',
      'institutionId',
      'transactionId',
      'email',
      'paidAmount',
    ]) {
      expect(payload).not.toContain(forbidden);
    }
  });

  it('falls back to the creation day when the description is null', () => {
    const mapped = mapPublicReceivableShare(
      shareRow({
        items: [
          {
            receivable: receivable({
              description: null,
              createdAt: new Date('2026-10-03T12:00:00.000Z'),
            }),
          },
        ],
      }),
    );

    expect(mapped.items[0].concept).toBe('Cobro del 3 oct');
  });

  it('builds the fallback day in the owner timezone', () => {
    const mapped = mapPublicReceivableShare(
      shareRow({
        items: [
          {
            receivable: receivable({
              description: null,
              createdAt: new Date('2026-10-03T02:00:00.000Z'),
            }),
          },
        ],
      }),
    );

    expect(mapped.items[0].concept).toBe('Cobro del 2 oct');
  });
});
