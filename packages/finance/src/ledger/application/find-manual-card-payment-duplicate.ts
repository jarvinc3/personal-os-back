import type { CardPaymentOperation } from './reconcile-card-payment-import';

/**
 * ADR-003: un movimiento escrito a mano se compara con lo importado dentro de
 * ±10 minutos. La importación usa ventanas más largas porque el correo puede
 * llegar días después; aquí el usuario acaba de escribir la fecha.
 */
export const CARD_PAYMENT_MANUAL_DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

/** El pago que el usuario acaba de escribir en la ruta manual. */
export type ManualCardPayment = {
  accountId: string;
  cardId: string;
  amount: number;
  currency: string;
  transactionDate: Date;
  bankReference: string | null;
};

/** Datos mínimos para mostrar el pago importado que ya existe. */
export type CardPaymentDuplicateCandidate = {
  transactionId: string;
  transferGroupId: string;
  accountId: string;
  cardId: string;
  amount: number;
  currency: string;
  transactionDate: Date;
  description: string | null;
};

export type PossibleManualCardPaymentDuplicate = {
  kind: 'possible_duplicate';
  matchedBy: 'REFERENCE' | 'SIMILAR';
  candidate: CardPaymentDuplicateCandidate;
};

export type ManualCardPaymentDuplicate =
  { kind: 'none' } | PossibleManualCardPaymentDuplicate;

function distanceInMs(
  incoming: ManualCardPayment,
  operation: CardPaymentOperation,
): number {
  return Math.abs(
    operation.transactionDate.getTime() - incoming.transactionDate.getTime(),
  );
}

/**
 * Misma cuenta de origen, tarjeta, monto y moneda, cerca en el tiempo. No se
 * descarta el candidato por traer referencia: el pago manual casi nunca la trae
 * y sigue siendo la misma operación.
 */
function matchesBySimilarity(
  incoming: ManualCardPayment,
  operation: CardPaymentOperation,
): boolean {
  return (
    operation.accountId === incoming.accountId &&
    operation.cardId === incoming.cardId &&
    operation.amount === incoming.amount &&
    operation.currency === incoming.currency &&
    distanceInMs(incoming, operation) <= CARD_PAYMENT_MANUAL_DUPLICATE_WINDOW_MS
  );
}

function matchesByReference(
  incoming: ManualCardPayment,
  operation: CardPaymentOperation,
): boolean {
  return (
    incoming.bankReference !== null &&
    operation.externalReference === incoming.bankReference
  );
}

/** Un solo candidato estable: el más cercano en fecha y, en empate, el id. */
function closestToManual(
  incoming: ManualCardPayment,
  candidates: readonly CardPaymentOperation[],
): CardPaymentOperation {
  return candidates.reduce((closest, operation) => {
    const distance = distanceInMs(incoming, operation);
    const closestDistance = distanceInMs(incoming, closest);
    if (distance !== closestDistance) {
      return distance < closestDistance ? operation : closest;
    }
    return operation.sourceTransactionId < closest.sourceTransactionId
      ? operation
      : closest;
  });
}

function toCandidate(
  operation: CardPaymentOperation,
): CardPaymentDuplicateCandidate {
  return {
    transactionId: operation.sourceTransactionId,
    transferGroupId: operation.transferGroupId,
    accountId: operation.accountId,
    cardId: operation.cardId,
    amount: operation.amount,
    currency: operation.currency,
    transactionDate: operation.transactionDate,
    description: operation.description,
  };
}

function possibleDuplicate({
  incoming,
  candidates,
  matchedBy,
}: {
  incoming: ManualCardPayment;
  candidates: readonly CardPaymentOperation[];
  matchedBy: 'REFERENCE' | 'SIMILAR';
}): PossibleManualCardPaymentDuplicate {
  return {
    kind: 'possible_duplicate',
    matchedBy,
    candidate: toCandidate(closestToManual(incoming, candidates)),
  };
}

/**
 * Un pago manual que se parece a uno importado por correo no se guarda a
 * ciegas: el caller pide confirmación antes de escribir. Solo compiten pagos
 * importados; dos pagos manuales iguales son cosa del usuario.
 */
export function findManualCardPaymentDuplicate({
  incoming,
  existing,
}: {
  incoming: ManualCardPayment;
  existing: readonly CardPaymentOperation[];
}): ManualCardPaymentDuplicate {
  const imported = existing.filter((operation) => operation.imported);
  const referenceMatches = imported.filter((operation) =>
    matchesByReference(incoming, operation),
  );
  if (referenceMatches.length > 0) {
    return possibleDuplicate({
      incoming,
      candidates: referenceMatches,
      matchedBy: 'REFERENCE',
    });
  }
  const similar = imported.filter((operation) =>
    matchesBySimilarity(incoming, operation),
  );
  if (similar.length === 0) {
    return { kind: 'none' };
  }
  return possibleDuplicate({
    incoming,
    candidates: similar,
    matchedBy: 'SIMILAR',
  });
}
