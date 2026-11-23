import type { Prisma } from '@personal-os/database';

export type RecurringPatternWithMerchant =
  Prisma.FinRecurringPatternGetPayload<{ include: { merchantRef: true } }>;

export type RecurringPriceChange = {
  patternId: string;
  merchant: string;
  currency: string;
  previousAmount: number;
  newAmount: number;
};

export type RecurringDetectionOutcome = {
  patterns: RecurringPatternWithMerchant[];
  priceChanges: RecurringPriceChange[];
};
