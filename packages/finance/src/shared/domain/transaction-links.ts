export const TRANSACTION_LINK_KIND = {
  TRANSFER: 'TRANSFER',
  LOAN_INSTALLMENT: 'LOAN_INSTALLMENT',
  RECEIVABLE_PAYMENT: 'RECEIVABLE_PAYMENT',
  SAVINGS_CONTRIBUTION: 'SAVINGS_CONTRIBUTION',
} as const;

export type TransactionLinkKind =
  (typeof TRANSACTION_LINK_KIND)[keyof typeof TRANSACTION_LINK_KIND];

export const TRANSACTION_LINKED = 'TRANSACTION_LINKED';
export const TRANSACTION_LINK_INVALID = 'TRANSACTION_LINK_INVALID';
export const TRANSACTION_LINK_INVALID_MESSAGE =
  'Este movimiento no se puede vincular.';
export const TRANSACTION_NOT_LINKED = 'TRANSACTION_NOT_LINKED';
export const TRANSACTION_NOT_LINKED_MESSAGE =
  'Este movimiento no tiene un vínculo que quitar.';
export const TRANSACTION_LINK_TARGET_NOT_FOUND =
  'TRANSACTION_LINK_TARGET_NOT_FOUND';
export const TRANSACTION_LINK_TARGET_NOT_FOUND_MESSAGE =
  'No encontramos el destino del vínculo.';
export const TRANSACTION_LINK_AMOUNT_INVALID =
  'TRANSACTION_LINK_AMOUNT_INVALID';
export const TRANSACTION_LINK_AMOUNT_INVALID_MESSAGE =
  'El monto del movimiento no cabe en el destino del vínculo.';

const LINK_LABEL: Record<TransactionLinkKind, string> = {
  TRANSFER: 'una transferencia',
  LOAN_INSTALLMENT: 'una cuota del préstamo',
  RECEIVABLE_PAYMENT: 'un cobro',
  SAVINGS_CONTRIBUTION: 'un aporte a una meta',
};

export function transactionLinkedMessage(kind: TransactionLinkKind): string {
  if (kind === TRANSACTION_LINK_KIND.TRANSFER) {
    return 'Este movimiento es parte de una transferencia. Edítala desde ahí.';
  }
  return `Este movimiento está ligado a ${LINK_LABEL[kind]}. Edítalo desde ahí.`;
}
