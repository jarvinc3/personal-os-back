export function readTransaction(
  payload: unknown,
): { movementClass: string | null; accountNumberLast4: string | null } | null {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return null;
  }
  const transaction = (payload as Record<string, unknown>).transaction;
  if (typeof transaction !== 'object' || transaction === null) {
    return null;
  }
  const transactionFields = transaction as Record<string, unknown>;
  return {
    movementClass:
      typeof transactionFields.movementClass === 'string'
        ? transactionFields.movementClass
        : null,
    accountNumberLast4:
      typeof transactionFields.accountNumberLast4 === 'string'
        ? transactionFields.accountNumberLast4
        : null,
  };
}
