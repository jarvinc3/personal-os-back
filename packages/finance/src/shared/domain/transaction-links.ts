export const TRANSACTION_LINK_KIND = {
  TRANSFER: 'TRANSFER',
  LOAN_INSTALLMENT: 'LOAN_INSTALLMENT',
  RECEIVABLE_PAYMENT: 'RECEIVABLE_PAYMENT',
  SAVINGS_CONTRIBUTION: 'SAVINGS_CONTRIBUTION',
} as const;

export type TransactionLinkKind =
  (typeof TRANSACTION_LINK_KIND)[keyof typeof TRANSACTION_LINK_KIND];

export const TRANSACTION_LINKED = 'TRANSACTION_LINKED';

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
