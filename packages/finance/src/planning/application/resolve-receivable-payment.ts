import { BadRequestException } from '@nestjs/common';

export const RECEIVABLE_STATUSES = [
  'PENDING',
  'PARTIAL',
  'PAID',
  'CANCELLED',
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

  if (!Number.isFinite(amount) || amount < 0) {
    throw new BadRequestException('amount must be >= 0');
  }
  if (!Number.isFinite(paidAmount) || paidAmount < 0) {
    throw new BadRequestException('paidAmount must be >= 0');
  }
  if (paidAmount > amount) {
    throw new BadRequestException('paidAmount cannot exceed amount');
  }

  let status = input.status;
  if (!status) {
    if (paidAmount === 0) {
      status = 'PENDING';
    } else if (paidAmount === amount) {
      status = 'PAID';
    } else {
      status = 'PARTIAL';
    }
  }

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

  return { paidAmount, status };
}
