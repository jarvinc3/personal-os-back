import { Injectable } from '@nestjs/common';
import { AdjustBalanceUseCase } from '../../ledger/application/adjust-balance.use-case';
import { CreateTransactionUseCase } from '../../ledger/application/create-transaction.use-case';
import { roundMoney } from '../../shared/domain/money';
import type { StatementImportParsed } from '../domain/statement-import-view';
import type { StatementImportContext } from '../infrastructure/statement-imports.repository';
import { StatementImportState } from './statement-import-state';

/** Ledger side of an applied import: missing movements and balance adjustment. */
@Injectable()
export class StatementImportLedgerWriter {
  constructor(
    private readonly createTransaction: CreateTransactionUseCase,
    private readonly adjustBalance: AdjustBalanceUseCase,
    private readonly state: StatementImportState,
  ) {}

  async createMissingTransactions(
    context: StatementImportContext,
  ): Promise<void> {
    for (const line of context.lines) {
      if (line.decision !== 'CREATE' || line.transactionId) {
        continue;
      }
      const created = await this.createTransaction.execute(
        context.userId,
        {
          ...(context.cardId
            ? { cardId: context.cardId }
            : { accountId: context.accountId ?? undefined }),
          type: line.type,
          amount: Number(line.amount),
          currency: line.currency,
          transactionDate: line.date.toISOString(),
          merchant: line.description,
          description: line.description,
          ...(line.categoryId ? { categoryId: line.categoryId } : {}),
          status: 'CONFIRMED',
        },
        'MANUAL',
      );
      await this.state.linkLineTransaction(line.id, created.id);
    }
  }

  async applyAdjustment(
    context: StatementImportContext,
    parsed: StatementImportParsed,
  ): Promise<void> {
    const closing = parsed.header.closingBalance;
    if (closing === null) {
      return;
    }
    if (context.accountId) {
      await this.adjustBalance.execute(context.userId, {
        accountId: context.accountId,
        balance: closing,
      });
      return;
    }
    if (!context.cardId) {
      return;
    }
    const target = await this.state.findTargetBalance({
      userId: context.userId,
      cardId: context.cardId,
      accountId: null,
      currency: parsed.header.currency,
    });
    if (!target || target.creditLimit === null) {
      return;
    }
    await this.adjustBalance.execute(context.userId, {
      cardId: context.cardId,
      currency: parsed.header.currency,
      balance: roundMoney(target.creditLimit - closing),
    });
  }
}
