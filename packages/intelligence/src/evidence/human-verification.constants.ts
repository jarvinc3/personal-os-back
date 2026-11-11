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

/**
 * Clases de movimiento de la etiqueta. Finance mantiene su propia lista; allí
 * CARD_PAYMENT llega con la importación de pagos (#335).
 */
export const TRANSACTION_MOVEMENT_CLASSES = [
  'PURCHASE',
  'INCOME',
  'PAYROLL',
  'ATM_WITHDRAWAL',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'CARD_PAYMENT',
  'FEE',
  'REFUND',
  'OTHER',
] as const;

export const SUGGESTED_TRANSACTION_DATE_SOURCES = ['EMAIL_HEADER'] as const;

export const HUMAN_VERIFICATION_VERDICTS = [
  'CONFIRMED',
  'CORRECTED',
  'REJECTED',
] as const;

export const REVIEW_GROUP_VERDICTS = ['CONFIRMED', 'CORRECTED'] as const;

export const HUMAN_VERIFICATION_SELECTION_MAX_MESSAGES = 20;

export type SemanticType = (typeof SEMANTIC_TYPES)[number];
export type SemanticRoute = (typeof SEMANTIC_ROUTES)[number];
export type HumanVerificationVerdict =
  (typeof HUMAN_VERIFICATION_VERDICTS)[number];
