import { BadRequestException, ConflictException } from '@nestjs/common';
import { roundMoney } from '../../shared/domain/money';
import {
  TRANSACTION_LINK_AMOUNT_INVALID,
  TRANSACTION_LINK_AMOUNT_INVALID_MESSAGE,
  TRANSACTION_LINK_INVALID,
  TRANSACTION_LINK_INVALID_MESSAGE,
} from '../../shared/domain/transaction-links';
import type { LedgerTransactionRow } from '../../ledger/application/ports/ledger.repository.port';
import { installmentDueTotal } from '../domain/loan-payment';

type LinkedInstallment = {
  principal: unknown;
  interest: unknown;
  insurance: unknown;
  fees: unknown;
  lateFee: unknown;
};

/** The movement must match the instalment's currency and not exceed it. */
export function resolveLinkedAmount(input: {
  movement: LedgerTransactionRow;
  loanCurrency: string;
  installment: LinkedInstallment;
}): number {
  const { movement, loanCurrency, installment } = input;
  const movementCurrency = movement.ledgerCurrency ?? movement.currency;
  if (movementCurrency !== loanCurrency) {
    throw new ConflictException({
      code: TRANSACTION_LINK_INVALID,
      message: TRANSACTION_LINK_INVALID_MESSAGE,
    });
  }
  const amount = roundMoney(Number(movement.ledgerAmount ?? movement.amount));
  const dueTotal = installmentDueTotal({
    principal: Number(installment.principal),
    interest: Number(installment.interest),
    insurance: Number(installment.insurance),
    fees: Number(installment.fees),
    lateFee: Number(installment.lateFee),
  });
  if (amount > dueTotal + 0.005) {
    throw new BadRequestException({
      code: TRANSACTION_LINK_AMOUNT_INVALID,
      message: TRANSACTION_LINK_AMOUNT_INVALID_MESSAGE,
    });
  }
  return amount;
}
