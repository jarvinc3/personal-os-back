import { logicalTransactionsWhere } from './logical-transaction-query';

describe('logicalTransactionsWhere', () => {
  it('lists standalone rows plus debit legs of transfers', () => {
    const where = logicalTransactionsWhere('user-1', {});
    expect(where.userId).toBe('user-1');
    expect(where.AND).toEqual(
      expect.arrayContaining([
        {
          OR: [
            { transferGroupId: null },
            { transferGroupId: { not: null }, type: 'DEBIT' },
          ],
        },
      ]),
    );
  });

  it('filters TRANSFER as debit legs of a group', () => {
    const where = logicalTransactionsWhere('user-1', { type: 'TRANSFER' });
    expect(where.AND).toEqual(
      expect.arrayContaining([
        { transferGroupId: { not: null }, type: 'DEBIT' },
      ]),
    );
  });

  it('excludes transfer legs from DEBIT and CREDIT filters', () => {
    const debit = logicalTransactionsWhere('user-1', { type: 'DEBIT' });
    expect(debit.AND).toEqual(
      expect.arrayContaining([{ type: 'DEBIT', transferGroupId: null }]),
    );
    const credit = logicalTransactionsWhere('user-1', { type: 'CREDIT' });
    expect(credit.AND).toEqual(
      expect.arrayContaining([{ type: 'CREDIT', transferGroupId: null }]),
    );
  });

  it('includes transfer groups when filtering by destination account', () => {
    const where = logicalTransactionsWhere(
      'user-1',
      { accountId: 'acc-to' },
      ['grp-1'],
    );
    expect(where.AND).toEqual(
      expect.arrayContaining([
        {
          OR: [
            { transferGroupId: null, accountId: 'acc-to' },
            { transferGroupId: { in: ['grp-1'] }, type: 'DEBIT' },
          ],
        },
      ]),
    );
  });

  it('does not include transfer groups when filtering DEBIT by account', () => {
    const where = logicalTransactionsWhere(
      'user-1',
      { type: 'DEBIT', accountId: 'acc-1' },
      ['grp-1'],
    );
    expect(where.AND).toEqual(
      expect.arrayContaining([{ accountId: 'acc-1' }]),
    );
    expect(JSON.stringify(where)).not.toContain('grp-1');
  });
});
