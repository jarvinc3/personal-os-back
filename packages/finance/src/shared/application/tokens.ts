export const EXCHANGE_RATE_PORT = Symbol('EXCHANGE_RATE_PORT');
export const QUICK_ENTRY_EXTRACTOR = Symbol('QUICK_ENTRY_EXTRACTOR');
export const LEDGER_QUERY_REPOSITORY = Symbol('LEDGER_QUERY_REPOSITORY');
export const LEDGER_WRITE_REPOSITORY = Symbol('LEDGER_WRITE_REPOSITORY');
export const LEDGER_STATUS_REPOSITORY = Symbol('LEDGER_STATUS_REPOSITORY');
export const LEDGER_REVERSAL_REPOSITORY = Symbol('LEDGER_REVERSAL_REPOSITORY');
export const LEDGER_DELETION_REPOSITORY = Symbol('LEDGER_DELETION_REPOSITORY');
export const LEDGER_IMPORT_REPOSITORY = Symbol('LEDGER_IMPORT_REPOSITORY');
/** Planning capability port used by ledger after budget spend adjustments. */
export const BUDGET_THRESHOLD_PORT = Symbol('BUDGET_THRESHOLD_PORT');
/** Subscriptions capability port used by ledger after persisting a movement. */
export const SUBSCRIPTION_MATCHER = Symbol('SUBSCRIPTION_MATCHER');
