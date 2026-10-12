import { mapLedgerTransaction, mapLogicalTransaction } from './ledger-mappers';
import type { LedgerTransactionRow } from './ports/ledger.repository.port';

function row(
  overrides: Partial<LedgerTransactionRow> & { id: string; type: string },
): LedgerTransactionRow {
  return {
    userId: 'user-1',
    accountId: null,
    cardId: null,
    amount: 50,
    ledgerAmount: 50,
    amountBaseCurrency: 50,
    currency: 'DOP',
    ledgerCurrency: 'DOP',
    exchangeRate: 1,
    merchant: null,
    description: null,
    notes: null,
    categoryId: null,
    status: 'CONFIRMED',
    source: 'MANUAL',
    transferGroupId: null,
    linkedTransactionId: null,
    transactionDate: new Date('2026-09-11T12:00:00.000Z'),
    createdAt: new Date('2026-09-11T12:00:00.000Z'),
    ...overrides,
  };
}

describe('mapLogicalTransaction', () => {
  it('keeps standalone DEBIT/CREDIT types', () => {
    const mapped = mapLogicalTransaction(
      row({ id: 'd1', type: 'DEBIT', accountId: 'acc-1' }),
    );
    expect(mapped.type).toBe('DEBIT');
    expect(mapped.transferToAccountId).toBeNull();
  });

  it('exposes a transfer as a single TRANSFER with origin and destination', () => {
    const debit = row({
      id: 'd1',
      type: 'DEBIT',
      accountId: 'acc-from',
      transferGroupId: 'grp-1',
      account: { id: 'acc-from', name: 'Nómina' },
    });
    const credit = row({
      id: 'c1',
      type: 'CREDIT',
      accountId: 'acc-to',
      transferGroupId: 'grp-1',
      account: { id: 'acc-to', name: 'Ahorros' },
    });
    const mapped = mapLogicalTransaction(debit, credit);
    expect(mapped.type).toBe('TRANSFER');
    expect(mapped.accountName).toBe('Nómina');
    expect(mapped.transferToAccountName).toBe('Ahorros');
    expect(mapped.transferToAccountId).toBe('acc-to');
    expect(mapped.institutionLogoUrl).toBeNull();
    expect(mapped.transferToNetworkLogoUrl).toBeNull();
  });

  it('copies institution and network logos onto the origin and the counterpart', () => {
    const logos = {
      resolveUrl: (row?: { logoUrl?: string | null } | null) =>
        row?.logoUrl ?? null,
      networkLogoUrl: (network: string | null | undefined) =>
        network === 'VISA' ? 'https://cdn.example/visa.png' : null,
    };
    const mapped = mapLogicalTransaction(
      row({
        id: 'd1',
        type: 'DEBIT',
        cardId: 'card-1',
        transferGroupId: 'grp-1',
        card: {
          id: 'card-1',
          name: 'Visa Nómina',
          network: 'VISA',
          institution: { logoUrl: 'https://cdn.example/bhd.png' },
        },
      }),
      row({
        id: 'c1',
        type: 'CREDIT',
        accountId: 'acc-to',
        transferGroupId: 'grp-1',
        account: {
          id: 'acc-to',
          name: 'Ahorros',
          institutionRef: { logoUrl: 'https://cdn.example/popular.png' },
        },
      }),
      logos,
    );
    expect(mapped.institutionLogoUrl).toBe('https://cdn.example/bhd.png');
    expect(mapped.network).toBe('VISA');
    expect(mapped.networkLogoUrl).toBe('https://cdn.example/visa.png');
    expect(mapped.transferToNetwork).toBeNull();
    expect(mapped.transferToInstitutionLogoUrl).toBe(
      'https://cdn.example/popular.png',
    );
    expect(mapped.transferToNetworkLogoUrl).toBeNull();
  });

  it('does not rewrite physical legs used by create-transfer responses', () => {
    const debit = mapLedgerTransaction(
      row({
        id: 'd1',
        type: 'DEBIT',
        transferGroupId: 'grp-1',
      }),
    );
    expect(debit.type).toBe('DEBIT');
  });

  it('exposes how much a movement can be edited by status', () => {
    expect(
      mapLedgerTransaction(
        row({ id: 'c1', type: 'DEBIT', status: 'CONFIRMED' }),
      ).editable,
    ).toBe('METADATA');
    expect(
      mapLedgerTransaction(row({ id: 'p1', type: 'DEBIT', status: 'PENDING' }))
        .editable,
    ).toBe('FULL');
    expect(
      mapLedgerTransaction(row({ id: 'r1', type: 'DEBIT', status: 'REVERSED' }))
        .editable,
    ).toBe('NOTES');
  });
});
