/** System expense category a transfer fee posts to. */
export const TRANSFER_FEE_CATEGORY_NAME = 'Comisiones bancarias';

export const OPERATION_LEG_ROLE = {
  SOURCE: 'SOURCE',
  DESTINATION: 'DESTINATION',
  FEE: 'FEE',
} as const;

export type OperationLegRole =
  (typeof OPERATION_LEG_ROLE)[keyof typeof OPERATION_LEG_ROLE];

export const TRANSFER_LOCKED = 'TRANSFER_LOCKED';
export const TRANSFER_LOCKED_MESSAGE =
  'Esta transferencia está completada. Márcala como pendiente para editarla.';
