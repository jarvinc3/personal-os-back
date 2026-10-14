/**
 * Port for subscription payment matching after a movement is persisted.
 * Implemented by subscriptions; consumed by ledger (no circular Nest import).
 */
export interface SubscriptionMatcherPort {
  /**
   * Register a payment when exactly one active subscription matches; do
   * nothing when none or several match (the user confirms those by hand).
   */
  matchTransaction(input: {
    userId: string;
    transactionId: string;
  }): Promise<void>;
}
