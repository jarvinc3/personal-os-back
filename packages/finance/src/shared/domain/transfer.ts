/** System expense category a transfer fee posts to. */
export const TRANSFER_FEE_CATEGORY_NAME = 'Comisiones bancarias';

/** Dos correos con la misma referencia se comparan dentro de este margen. */
export const TRANSFER_REFERENCE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const OPERATION_LEG_ROLE = {
  SOURCE: 'SOURCE',
  DESTINATION: 'DESTINATION',
  FEE: 'FEE',
} as const;

export type OperationLegRole =
  (typeof OPERATION_LEG_ROLE)[keyof typeof OPERATION_LEG_ROLE];

export const OPERATION_TYPE = {
  TRANSFER: 'TRANSFER',
} as const;

export type OperationType =
  (typeof OPERATION_TYPE)[keyof typeof OPERATION_TYPE];

export const TRANSFER_LOCKED = 'TRANSFER_LOCKED';
export const TRANSFER_LOCKED_MESSAGE =
  'Esta transferencia está completada. Márcala como pendiente para editarla.';

export const SAME_ACCOUNT = 'SAME_ACCOUNT';
export const SAME_ACCOUNT_MESSAGE =
  'El origen y el destino no pueden ser la misma cuenta.';

export const ACCOUNT_NOT_FOUND = 'ACCOUNT_NOT_FOUND';
export const ACCOUNT_NOT_FOUND_MESSAGE = 'No encontramos la cuenta.';

export const TRANSFER_TARGET_NOT_ACCOUNT = 'TRANSFER_TARGET_NOT_ACCOUNT';
export const TRANSFER_TARGET_NOT_ACCOUNT_MESSAGE =
  'El destino de una transferencia debe ser una cuenta. Para pagar una tarjeta usa Pagar tarjeta.';

export const TRANSFER_NOT_COMPLETED = 'TRANSFER_NOT_COMPLETED';
export const TRANSFER_NOT_COMPLETED_MESSAGE =
  'Solo una transferencia completada se puede reversar.';
