import type { Prisma } from '@personal-os/database';
import { normalizeCurrencyCode } from '../../shared/domain/money';
import type { TransactionUpdateFields } from '../application/commands/ledger.commands';

/** Campos de una edición: solo viaja lo que el DTO declaró. */
export function buildUpdateData(
  fields: TransactionUpdateFields,
): Prisma.FinTransactionUncheckedUpdateManyInput {
  return {
    ...textFields(fields),
    ...amountFields(fields),
    ...stateFields(fields),
  };
}

function textFields(
  fields: TransactionUpdateFields,
): Prisma.FinTransactionUncheckedUpdateManyInput {
  return {
    ...(fields.merchant !== undefined ? { merchant: fields.merchant } : {}),
    ...(fields.merchantId !== undefined
      ? { merchantId: fields.merchantId }
      : {}),
    ...(fields.description !== undefined
      ? { description: fields.description }
      : {}),
    ...(fields.notes !== undefined ? { notes: fields.notes } : {}),
  };
}

function amountFields(
  fields: TransactionUpdateFields,
): Prisma.FinTransactionUncheckedUpdateManyInput {
  return {
    ...(fields.amount !== undefined ? { amount: fields.amount } : {}),
    ...(fields.currency !== undefined
      ? { currency: normalizeCurrencyCode(fields.currency) }
      : {}),
    ...(fields.ledgerAmount !== undefined
      ? { ledgerAmount: fields.ledgerAmount }
      : {}),
    ...(fields.ledgerCurrency !== undefined
      ? { ledgerCurrency: fields.ledgerCurrency }
      : {}),
    ...(fields.amountBaseCurrency !== undefined
      ? { amountBaseCurrency: fields.amountBaseCurrency }
      : {}),
    ...(fields.exchangeRate !== undefined
      ? { exchangeRate: fields.exchangeRate }
      : {}),
  };
}

function stateFields(
  fields: TransactionUpdateFields,
): Prisma.FinTransactionUncheckedUpdateManyInput {
  return {
    ...(fields.type !== undefined ? { type: fields.type } : {}),
    ...(fields.transactionDate !== undefined
      ? { transactionDate: fields.transactionDate }
      : {}),
    ...(fields.categoryId !== undefined
      ? { categoryId: fields.categoryId }
      : {}),
    ...(fields.status !== undefined ? { status: fields.status } : {}),
    ...(fields.isEstimated !== undefined
      ? { isEstimated: fields.isEstimated }
      : {}),
  };
}
