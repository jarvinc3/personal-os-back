import type { BudgetSpendSnapshot } from '../domain/budget-snapshot';

/**
 * Port for budget threshold alerts after ledger spend changes.
 * Implemented by planning; consumed by ledger (no circular Nest import of services).
 */
export interface BudgetThresholdPort {
  /**
   * Record alerts + enqueue finance.budget.threshold_crossed inside optional TX client.
   */
  processThresholds(
    userId: string,
    snapshots: BudgetSpendSnapshot[],
    tx?: unknown,
  ): Promise<void>;
}
