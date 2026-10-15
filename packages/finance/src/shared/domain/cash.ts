/** Cash model constants (pendiente 16). */

export const CASH_INSTITUTION_TYPE = 'cash';
export const CASH_INSTITUTION_NAME = 'Efectivo';
export const CASH_ACCOUNT_TYPE = 'CASH';

/** A cash institution: the system "Efectivo" or a legacy user-created one. */
export function isCashInstitution(institution: { type: string }): boolean {
  return institution.type === CASH_INSTITUTION_TYPE;
}
