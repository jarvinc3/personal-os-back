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

function branchById(id: string): DataBranchDescriptor {
  const branch = FINANCE_DATA_BRANCHES.find((candidate) => candidate.id === id);
  if (!branch) {
    throw new Error(`La rama ${id} no está declarada`);
  }
  return branch;
}

function countRows(): ReadonlyMap<string, DataBranchCount> {
  const rows = groupDataBranchCounts(
    FINANCE_DATA_BRANCHES,
    ROW_COUNT_BY_BRANCH,
  ).flatMap((group) => group.branches);
  return new Map(rows.map((row) => [row.id, row]));
}

function countRow(
  rowsById: ReadonlyMap<string, DataBranchCount>,
  id: string,
): DataBranchCount {
  const row = rowsById.get(id);
  if (!row) {
    throw new Error(`La rama ${id} no aparece en el listado`);
  }
  return row;
}

describe('FINANCE_DATA_BRANCHES', () => {
  it('declares what the schema deletes with the products and institutions', () => {
    expect(branchById('finance.cards').includes).toEqual([
      'finance.reconciliations',
      'finance.transactions',
      'finance.statements',
    ]);
    expect(branchById('finance.accounts').includes).toEqual([
      'finance.reconciliations',
      'finance.transactions',
      'finance.loans',
    ]);
    expect(branchById('finance.institutions').includes).toEqual([
      'finance.accounts',
      'finance.cards',
      'finance.loans',
    ]);
  });

  it('keeps credit cards out of the accounts branch', () => {
    expect(branchById('finance.accounts').includes).not.toContain(
      'finance.cards',
    );
  });

  it('points every include at a branch with its own count', () => {
    const rowsById = countRows();

    for (const branch of FINANCE_DATA_BRANCHES) {
      const row = countRow(rowsById, branch.id);
      for (const included of branch.includes) {
        expect(row.includes).toContainEqual({
          id: included,
          count: countRow(rowsById, included).count,
        });
      }
    }
  });

  it('runs every dragged branch before the one that drags it', () => {
    for (const branch of FINANCE_DATA_BRANCHES) {
      for (const included of branch.includes) {
        expect(branchById(included).order).toBeLessThan(branch.order);
      }
    }
  });

  it('never drags itself nor repeats a branch', () => {
    for (const branch of FINANCE_DATA_BRANCHES) {
      expect(branch.includes).not.toContain(branch.id);
      expect(new Set(branch.includes).size).toBe(branch.includes.length);
    }
  });

  it('expands the cards into the rows they drag, in execution order', () => {
    const applied = expandDataBranches(FINANCE_DATA_BRANCHES, [
      'finance.cards',
    ]).map((branch) => branch.id);

    expect(applied).toEqual([
      'finance.reconciliations',
      'finance.transactions',
      'finance.statements',
      'finance.cards',
    ]);
  });

  it('expands the institutions into everything they drag, in execution order', () => {
    const applied = expandDataBranches(FINANCE_DATA_BRANCHES, [
      'finance.institutions',
    ]).map((branch) => branch.id);

    expect(applied).toEqual([
      'finance.reconciliations',
      'finance.transactions',
      'finance.statements',
      'finance.loans',
      'finance.cards',
      'finance.accounts',
      'finance.institutions',
    ]);
  });
});
