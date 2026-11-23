import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '@personal-os/database';
import type { ResolvedAmounts } from '../../shared/domain/money';
import {
  OPERATION_LEG_ROLE,
  TRANSFER_FEE_CATEGORY_NAME,
} from '../../shared/domain/transfer';
import type { FinTxStatus } from '../application/commands/ledger.commands';
import type { LedgerTransactionRow } from '../application/ports/ledger.repository.port';

/** Pata de comisión de una transferencia: se crea o se actualiza con el grupo. */
export class TransferFeeLeg {
  async upsert(
    tx: Prisma.TransactionClient,
    input: {
      userId: string;
      transferGroupId: string | null;
      source: LedgerTransactionRow;
      feeAmounts: ResolvedAmounts;
      feeCategoryId?: string | null;
    },
  ): Promise<void> {
    if (!input.transferGroupId) {
      throw new NotFoundException('Grupo de transferencia no encontrado');
    }
    const amountFields = {
      amount: input.feeAmounts.amount,
      currency: input.feeAmounts.currency,
      ledgerAmount: input.feeAmounts.ledgerAmount,
      ledgerCurrency: input.feeAmounts.ledgerCurrency,
      amountBaseCurrency: input.feeAmounts.amountBaseCurrency,
      exchangeRate: input.feeAmounts.exchangeRate,
    };
    const existingFeeLeg = await tx.finTransaction.findFirst({
      where: {
        userId: input.userId,
        transferGroupId: input.transferGroupId,
        legRole: OPERATION_LEG_ROLE.FEE,
      },
      select: { id: true },
    });
    if (existingFeeLeg) {
      await tx.finTransaction.update({
        where: { id: existingFeeLeg.id },
        data: {
          ...amountFields,
          ...(input.feeCategoryId ? { categoryId: input.feeCategoryId } : {}),
        },
      });
      return;
    }
    await tx.finTransaction.create({
      data: {
        userId: input.userId,
        accountId: input.source.accountId,
        cardId: input.source.cardId,
        type: 'DEBIT',
        status: input.source.status as FinTxStatus,
        legRole: OPERATION_LEG_ROLE.FEE,
        transferGroupId: input.transferGroupId,
        transactionDate: input.source.transactionDate,
        categoryId: input.feeCategoryId ?? (await this.resolveCategoryId(tx)),
        ...amountFields,
      },
    });
  }

  async resolveCategoryId(
    tx: Prisma.TransactionClient,
  ): Promise<string | null> {
    const category = await tx.finCategory.findFirst({
      where: {
        isSystem: true,
        name: TRANSFER_FEE_CATEGORY_NAME,
        type: 'EXPENSE',
      },
      select: { id: true },
    });
    return category?.id ?? null;
  }
}
