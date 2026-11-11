/**
 * Reglas de conciliación acordadas para el pago de tarjeta importado:
 * una referencia presente compara contra cualquier pata del pago existente con
 * siete días de ventana; sin referencia solo compiten pagos sin referencia,
 * con tres días, para no enlazar una operación que ya trae su propia referencia.
 */
export const CARD_PAYMENT_REFERENCE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const CARD_PAYMENT_SIMILAR_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export type CardPaymentOperation = {
  transferGroupId: string;
  sourceTransactionId: string;
  accountId: string;
  cardId: string;
  externalReference: string | null;
  amount: number;
  currency: string;
  transactionDate: Date;
};

export type IncomingCardPayment = {
  accountId: string;
  cardId: string;
  amount: number;
  currency: string;
  transactionDate: Date;
  bankReference: string | null;
};

export type CardPaymentImportDecision =
  | { kind: 'new' }
  | {
      kind: 'duplicate';
      transactionId: string;
      transferGroupId: string;
      matchedBy: 'REFERENCE' | 'SIMILAR';
    }
  | {
      kind: 'conflict';
      reason: 'CARD_PAYMENT_REFERENCE_CONFLICT';
      candidateTransactionIds: string[];
    }
  | {
      kind: 'ambiguous';
      reason: 'CARD_PAYMENT_RECONCILIATION_AMBIGUOUS';
      candidateTransactionIds: string[];
    };

function withinWindow(
  left: Date,
  right: Date,
  windowMs: number,
): boolean {
  return Math.abs(left.getTime() - right.getTime()) <= windowMs;
}

function isSameOperation(
  incoming: IncomingCardPayment,
  existing: CardPaymentOperation,
): boolean {
  return (
    existing.accountId === incoming.accountId &&
    existing.cardId === incoming.cardId &&
    existing.amount === incoming.amount &&
    existing.currency === incoming.currency
  );
}

function duplicateOf(
  existing: CardPaymentOperation,
  matchedBy: 'REFERENCE' | 'SIMILAR',
): CardPaymentImportDecision {
  return {
    kind: 'duplicate',
    transactionId: existing.sourceTransactionId,
    transferGroupId: existing.transferGroupId,
    matchedBy,
  };
}

export function reconcileCardPaymentImport({
  incoming,
  existing,
}: {
  incoming: IncomingCardPayment;
  existing: readonly CardPaymentOperation[];
}): CardPaymentImportDecision {
  const referenceMatches = incoming.bankReference
    ? existing.filter(
        (operation) =>
          operation.externalReference === incoming.bankReference,
      )
    : [];
  if (referenceMatches.length > 0) {
    const exact = referenceMatches.filter(
      (operation) =>
        isSameOperation(incoming, operation) &&
        withinWindow(
          incoming.transactionDate,
          operation.transactionDate,
          CARD_PAYMENT_REFERENCE_WINDOW_MS,
        ),
    );
    if (exact.length === 1) {
      return duplicateOf(exact[0], 'REFERENCE');
    }
    if (exact.length > 1) {
      return {
        kind: 'ambiguous',
        reason: 'CARD_PAYMENT_RECONCILIATION_AMBIGUOUS',
        candidateTransactionIds: exact.map(
          ({ sourceTransactionId }) => sourceTransactionId,
        ),
      };
    }
    return {
      kind: 'conflict',
      reason: 'CARD_PAYMENT_REFERENCE_CONFLICT',
      candidateTransactionIds: referenceMatches.map(
        ({ sourceTransactionId }) => sourceTransactionId,
      ),
    };
  }

  const similar = existing.filter(
    (operation) =>
      operation.externalReference === null &&
      isSameOperation(incoming, operation) &&
      withinWindow(
        incoming.transactionDate,
        operation.transactionDate,
        CARD_PAYMENT_SIMILAR_WINDOW_MS,
      ),
  );
  if (similar.length === 1) {
    return duplicateOf(similar[0], 'SIMILAR');
  }
  if (similar.length > 1) {
    return {
      kind: 'ambiguous',
      reason: 'CARD_PAYMENT_RECONCILIATION_AMBIGUOUS',
      candidateTransactionIds: similar.map(
        ({ sourceTransactionId }) => sourceTransactionId,
      ),
    };
  }
  return { kind: 'new' };
}
