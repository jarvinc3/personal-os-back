/** Stable codes the API returns so the web can translate them once. */
export const STATEMENT_IMPORT_ERROR = {
  PASSWORD_REQUIRED: 'STATEMENT_PASSWORD_REQUIRED',
  PARSE_FAILED: 'STATEMENT_PARSE_FAILED',
  ALREADY_APPLIED: 'STATEMENT_ALREADY_APPLIED',
  DISCARDED: 'STATEMENT_IMPORT_DISCARDED',
} as const;

export type StatementImportErrorCode =
  (typeof STATEMENT_IMPORT_ERROR)[keyof typeof STATEMENT_IMPORT_ERROR];
