import type { FinTransactionStatusValue } from './transaction-status';

export const TRANSACTION_EDITABILITY = {
  FULL: 'FULL',
  METADATA: 'METADATA',
  NOTES: 'NOTES',
  NONE: 'NONE',
} as const;

export type TransactionEditability =
  (typeof TRANSACTION_EDITABILITY)[keyof typeof TRANSACTION_EDITABILITY];

export type TransactionEditableField =
  | 'type'
  | 'accountId'
  | 'cardId'
  | 'amount'
  | 'currency'
  | 'merchant'
  | 'description'
  | 'notes'
  | 'transactionDate'
  | 'categoryId'
  | 'status';

export type TransactionEditPolicy = {
  editable: TransactionEditability;
  allowedFields: readonly TransactionEditableField[];
};

export type TransactionEditBlock = {
  code: string;
  message: string;
};

export const TRANSACTION_LOCKED = 'TRANSACTION_LOCKED';
export const TRANSACTION_IMMUTABLE = 'TRANSACTION_IMMUTABLE';

export const TRANSACTION_LOCKED_MESSAGE =
  'Este movimiento está completado. Márcalo como pendiente para editarlo.';
export const TRANSACTION_IMMUTABLE_MESSAGE =
  'Este movimiento ya no se puede editar.';

const ALL_FIELDS: readonly TransactionEditableField[] = [
  'type',
  'accountId',
  'cardId',
  'amount',
  'currency',
  'merchant',
  'description',
  'notes',
  'transactionDate',
  'categoryId',
  'status',
];

const METADATA_FIELDS: readonly TransactionEditableField[] = [
  'categoryId',
  'merchant',
  'description',
  'notes',
];

const NOTES_FIELDS: readonly TransactionEditableField[] = ['notes'];

const REVERSED_FIELDS: readonly TransactionEditableField[] = [
  'categoryId',
  'notes',
];

const EDIT_POLICY: Record<FinTransactionStatusValue, TransactionEditPolicy> = {
  PENDING: {
    editable: TRANSACTION_EDITABILITY.FULL,
    allowedFields: ALL_FIELDS,
  },
  CONFIRMED: {
    editable: TRANSACTION_EDITABILITY.METADATA,
    allowedFields: METADATA_FIELDS,
  },
  REVERSED: {
    editable: TRANSACTION_EDITABILITY.NOTES,
    allowedFields: REVERSED_FIELDS,
  },
  CANCELLED: {
    editable: TRANSACTION_EDITABILITY.NOTES,
    allowedFields: NOTES_FIELDS,
  },
  DECLINED: {
    editable: TRANSACTION_EDITABILITY.NOTES,
    allowedFields: NOTES_FIELDS,
  },
};

export function transactionEditPolicy(
  status: FinTransactionStatusValue,
): TransactionEditPolicy {
  return EDIT_POLICY[status];
}

/** Fields the command sends that the current status does not allow editing. */
export function findDisallowedEditFields(
  status: FinTransactionStatusValue,
  command: Partial<Record<TransactionEditableField, unknown>>,
): TransactionEditableField[] {
  const { allowedFields } = transactionEditPolicy(status);
  return (Object.keys(command) as TransactionEditableField[]).filter(
    (field) => command[field] !== undefined && !allowedFields.includes(field),
  );
}

export function transactionEditBlock(
  status: FinTransactionStatusValue,
  command: Partial<Record<TransactionEditableField, unknown>>,
): TransactionEditBlock | null {
  if (findDisallowedEditFields(status, command).length === 0) {
    return null;
  }
  if (
    transactionEditPolicy(status).editable === TRANSACTION_EDITABILITY.METADATA
  ) {
    return { code: TRANSACTION_LOCKED, message: TRANSACTION_LOCKED_MESSAGE };
  }
  return {
    code: TRANSACTION_IMMUTABLE,
    message: TRANSACTION_IMMUTABLE_MESSAGE,
  };
}
