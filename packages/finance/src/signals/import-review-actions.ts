/**
 * Acciones humanas admitidas sobre un import de correo en revisión. Cada una
 * sustituye un dato que el correo no permitía decidir; el descarte no registra
 * ningún movimiento en el ledger.
 */
export const IMPORT_REVIEW_ACTIONS = [
  'SET_DATE',
  'SET_DESTINATION',
  'LINK_REVERSAL',
  'DISCARD',
] as const;

export type ImportReviewAction = (typeof IMPORT_REVIEW_ACTIONS)[number];

export const IMPORT_REVIEW_ACTION = {
  SET_DATE: 'SET_DATE',
  SET_DESTINATION: 'SET_DESTINATION',
  LINK_REVERSAL: 'LINK_REVERSAL',
  DISCARD: 'DISCARD',
} as const satisfies Record<ImportReviewAction, ImportReviewAction>;
