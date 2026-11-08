export const MOVEMENT_CLASSES = [
  'PURCHASE',
  'INCOME',
  'PAYROLL',
  'ATM_WITHDRAWAL',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'FEE',
  'REFUND',
  'OTHER',
] as const;

export type MovementClass = (typeof MOVEMENT_CLASSES)[number];

export function isTransferMovementClass(
  movementClass: MovementClass | null | undefined,
): boolean {
  return movementClass === 'TRANSFER_OUT' || movementClass === 'TRANSFER_IN';
}

export function isAtmMovementClass(
  movementClass: MovementClass | null | undefined,
): boolean {
  return movementClass === 'ATM_WITHDRAWAL';
}
