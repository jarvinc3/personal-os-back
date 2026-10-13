import {
  DELETION_ENTITY,
  DELETION_MODEL,
  type DeletionSnapshot,
} from './deletion-snapshot';
import { deletedEntryLabel } from './recycle-bin';

function snapshotWith(
  model: (typeof DELETION_MODEL)[keyof typeof DELETION_MODEL],
  values: Record<string, unknown>,
): DeletionSnapshot {
  return { rows: [{ model, values }] };
}

describe('deletedEntryLabel', () => {
  it('reads the institution name', () => {
    const snapshot = snapshotWith(DELETION_MODEL.institution, {
      id: 'inst-1',
      name: 'Banco X',
    });

    expect(deletedEntryLabel(DELETION_ENTITY.institution, snapshot)).toBe(
      'Banco X',
    );
  });

  it('reads the loan lender name', () => {
    const snapshot = snapshotWith(DELETION_MODEL.loan, {
      id: 'loan-1',
      lenderName: 'Banco Y',
    });

    expect(deletedEntryLabel(DELETION_ENTITY.loan, snapshot)).toBe('Banco Y');
  });

  it('reads the movement description', () => {
    const snapshot = snapshotWith(DELETION_MODEL.transaction, {
      id: 'tx-1',
      description: 'Supermercado',
    });

    expect(deletedEntryLabel(DELETION_ENTITY.transaction, snapshot)).toBe(
      'Supermercado',
    );
  });

  it('returns null for a budget without a name', () => {
    const snapshot = snapshotWith(DELETION_MODEL.budget, { id: 'budget-1' });

    expect(deletedEntryLabel(DELETION_ENTITY.budget, snapshot)).toBeNull();
  });

  it('returns null when the label is blank', () => {
    const snapshot = snapshotWith(DELETION_MODEL.transaction, {
      id: 'tx-1',
      description: '   ',
    });

    expect(deletedEntryLabel(DELETION_ENTITY.transaction, snapshot)).toBeNull();
  });

  it('returns null when the primary row is missing', () => {
    const snapshot: DeletionSnapshot = {
      rows: [
        { model: DELETION_MODEL.loanInstallment, values: { id: 'inst-1' } },
      ],
    };

    expect(deletedEntryLabel(DELETION_ENTITY.loan, snapshot)).toBeNull();
  });
});
