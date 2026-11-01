export const SECURITY_ALERT = 'SECURITY_ALERT' as const;

export const SEMANTIC_TYPES = [
  'FIN_TRANSACTION',
  'PURCHASE_RECEIPT',
  'SUBSCRIPTION_BILLING',
  'FIN_STATEMENT_NOTICE',
  'FIN_ACCOUNT_NOTICE',
  'SECURITY_OTP',
  SECURITY_ALERT,
  'TECH_NOTIFICATION',
  'JOB',
  'CALENDAR_EVENT',
  'MARKETING',
  'SOCIAL',
  'OTHER',
] as const;

export const SEMANTIC_ROUTES = [
  'FINANCE',
  'SUBSCRIPTIONS',
  'CALENDAR',
  'SECURITY',
] as const;

export const TRANSACTION_KINDS = [
  'TRANSACTION',
  'PENDING',
  'NOT_TRANSACTION',
] as const;

export const TRANSACTION_DIRECTIONS = ['DEBIT', 'CREDIT', 'TRANSFER'] as const;

export const HUMAN_VERIFICATION_VERDICTS = [
  'CONFIRMED',
  'CORRECTED',
  'REJECTED',
] as const;

export const REVIEW_GROUP_VERDICTS = ['CONFIRMED', 'CORRECTED'] as const;

export type SemanticType = (typeof SEMANTIC_TYPES)[number];
export type SemanticRoute = (typeof SEMANTIC_ROUTES)[number];
export type HumanVerificationVerdict =
  (typeof HUMAN_VERIFICATION_VERDICTS)[number];
