import { BadRequestException } from '@nestjs/common';

export const RECEIVABLE_STATUSES = [
  'PENDING',
  'PARTIAL',
  'PAID',
  'CANCELLED',
  'WRITTEN_OFF',
] as const;

export type ReceivableStatus = (typeof RECEIVABLE_STATUSES)[number];

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Cancelling a receivable is a manual decision, so it survives a recompute of
 * the collected sum; every other status follows that sum.
 */
export function resolveReceivableStatusOverride(input: {
  storedStatus: ReceivableStatus;
  requestedStatus?: ReceivableStatus;
}): ReceivableStatus | undefined {
  if (input.requestedStatus) {
    return input.requestedStatus;
  }
  if (input.storedStatus === 'CANCELLED') {
    return 'CANCELLED';
  }
  if (input.storedStatus === 'WRITTEN_OFF') {
    return 'WRITTEN_OFF';
  }
  return undefined;
}

/**
 * paidAmount must stay in [0, amount]. Status is explicit when provided;
 * otherwise it is derived from the resulting paidAmount.
 * PAID requires paidAmount === amount. CANCELLED does not.
 */
export function resolveReceivablePayment(input: {
  amount: number;
  paidAmount: number;
  status?: ReceivableStatus;
}): { paidAmount: number; status: ReceivableStatus } {
  const amount = roundMoney(input.amount);
  const paidAmount = roundMoney(input.paidAmount);

  assertValidReceivableAmounts({ amount, paidAmount });
  const status = input.status ?? statusFromPaidAmount({ amount, paidAmount });
  assertStatusMatchesAmount({ status, amount, paidAmount });

  return { paidAmount, status };
}

function assertValidReceivableAmounts(input: {
  amount: number;
  paidAmount: number;
}): void {
  const { amount, paidAmount } = input;
  if (!Number.isFinite(amount) || amount < 0) {
    throw new BadRequestException('el monto debe ser >= 0');
  }
  if (!Number.isFinite(paidAmount) || paidAmount < 0) {
    throw new BadRequestException('paidAmount debe ser >= 0');
  }
  if (paidAmount > amount) {
    throw new BadRequestException('paidAmount no puede superar el monto');
  }
}

function statusFromPaidAmount(input: {
  amount: number;
  paidAmount: number;
}): ReceivableStatus {
  if (input.paidAmount === 0) {
    return 'PENDING';
  }
  if (input.paidAmount === input.amount) {
    return 'PAID';
  }
  return 'PARTIAL';
}

function assertStatusMatchesAmount(input: {
  status: ReceivableStatus;
  amount: number;
  paidAmount: number;
}): void {
  const { status, amount, paidAmount } = input;
  if (status === 'PAID' && paidAmount !== amount) {
    throw new BadRequestException(
      'PAID receivables require paidAmount equal to amount',
    );
  }
  if (status === 'PARTIAL' && !(paidAmount > 0 && paidAmount < amount)) {
    throw new BadRequestException(
      'PARTIAL receivables require paidAmount between 0 and amount',
    );
  }
  if (status === 'PENDING' && paidAmount !== 0) {
    throw new BadRequestException(
      'PENDING receivables require paidAmount of 0',
    );
  }
  if (status === 'CANCELLED' && paidAmount > amount) {
    throw new BadRequestException('paidAmount no puede superar el monto');
  }
}
