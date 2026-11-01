import {
  expandDataBranches,
  groupDataBranchCounts,
  type DataBranchCount,
  type DataBranchDescriptor,
} from '@personal-os/users';
import { FINANCE_DATA_BRANCHES } from './finance-data-branches';

const ROW_COUNT_BY_BRANCH = Object.fromEntries(
  FINANCE_DATA_BRANCHES.map((branch, index) => [branch.id, index + 1]),
);

function requireBranch(id: string): DataBranchDescriptor {
  const branch = FINANCE_DATA_BRANCHES.find((candidate) => candidate.id === id);
  if (!branch) {
    throw new Error(`La rama ${id} no está declarada`);
  }
  return branch;
}

function countedRowsById(): ReadonlyMap<string, DataBranchCount> {
  const rows = groupDataBranchCounts(
    FINANCE_DATA_BRANCHES,
    ROW_COUNT_BY_BRANCH,
  ).flatMap((group) => group.branches);
  return new Map(rows.map((row) => [row.id, row]));
}

function requireCountedRow(
  rowsById: ReadonlyMap<string, DataBranchCount>,
  id: string,
): DataBranchCount {
  const row = rowsById.get(id);
  if (!row) {
    throw new Error(`La rama ${id} no aparece en el listado`);
  }
  return row;
}

function expandedIds(requested: string): string[] {
  return expandDataBranches(FINANCE_DATA_BRANCHES, [requested]).map(
    (branch) => branch.id,
  );
}

describe('FINANCE_DATA_BRANCHES', () => {
  it('declares what the schema deletes with the products and institutions', () => {
    expect(requireBranch('finance.cards').includes).toEqual([
      'finance.reconciliations',
      'finance.transactions',
      'finance.statements',
    ]);
    expect(requireBranch('finance.debitCards').includes).toEqual([]);
    expect(requireBranch('finance.accounts').includes).toEqual([
      'finance.reconciliations',
      'finance.transactions',
      'finance.loans',
      'finance.debitCards',
    ]);
    expect(requireBranch('finance.institutions').includes).toEqual([
      'finance.accounts',
      'finance.cards',
      'finance.debitCards',
      'finance.loans',
    ]);
  });

  it('keeps credit cards out of the accounts branch', () => {
    expect(requireBranch('finance.accounts').includes).not.toContain(
      'finance.cards',
    );
  });

  it('keeps debit cards out of the credit cards branch', () => {
    expect(requireBranch('finance.cards').includes).not.toContain(
      'finance.debitCards',
    );
  });

  it('points every include at a branch with its own count', () => {
    const rowsById = countedRowsById();

    for (const branch of FINANCE_DATA_BRANCHES) {
      const row = requireCountedRow(rowsById, branch.id);
      for (const included of branch.includes) {
        expect(row.includes).toContainEqual({
          id: included,
          count: requireCountedRow(rowsById, included).count,
        });
      }
    }
  });

  it('runs every dragged branch before the one that drags it', () => {
    for (const branch of FINANCE_DATA_BRANCHES) {
      for (const included of branch.includes) {
        expect(requireBranch(included).order).toBeLessThan(branch.order);
      }
    }
  });

  it('never drags itself nor repeats a branch', () => {
    for (const branch of FINANCE_DATA_BRANCHES) {
      expect(branch.includes).not.toContain(branch.id);
      expect(new Set(branch.includes).size).toBe(branch.includes.length);
    }
  });

  it('expands the credit cards into the rows they drag', () => {
    expect(expandedIds('finance.cards')).toEqual([
      'finance.reconciliations',
      'finance.transactions',
      'finance.statements',
      'finance.cards',
    ]);
  });

  it('expands the debit cards alone', () => {
    expect(expandedIds('finance.debitCards')).toEqual(['finance.debitCards']);
  });

  it('expands the accounts into the rows they drag, with the debit cards', () => {
    expect(expandedIds('finance.accounts')).toEqual([
      'finance.reconciliations',
      'finance.transactions',
      'finance.loans',
      'finance.debitCards',
      'finance.accounts',
    ]);
  });

  it('expands the institutions into everything they drag', () => {
    expect(expandedIds('finance.institutions')).toEqual([
      'finance.reconciliations',
      'finance.transactions',
      'finance.statements',
      'finance.loans',
      'finance.cards',
      'finance.debitCards',
      'finance.accounts',
      'finance.institutions',
    ]);
  });
});
