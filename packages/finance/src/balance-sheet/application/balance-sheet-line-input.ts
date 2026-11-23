import type { BalanceSheetBuckets } from './balance-sheet-buckets';
import type { BalanceSheetIndexes } from './balance-sheet-indexes';
import type { BalanceSheetRates } from './balance-sheet-rates';

export type BalanceSheetLineInput = {
  baseCurrency: string;
  asOf: Date;
  rates: BalanceSheetRates;
  indexes: BalanceSheetIndexes;
  buckets: BalanceSheetBuckets;
};
