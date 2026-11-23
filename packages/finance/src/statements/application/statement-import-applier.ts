import { ConflictException } from '@nestjs/common';
import { AdjustBalanceUseCase } from '../../ledger/application/adjust-balance.use-case';
import { CreateTransactionUseCase } from '../../ledger/application/create-transaction.use-case';
import { roundMoney } from '../../shared/domain/money';
import { STATEMENT_IMPORT_ERROR } from '../domain/statement-import-errors';
import {
  readParsedStatement,
  type StatementImportParsed,
} from '../domain/statement-import-view';
import { CardStatementsRepository } from '../infrastructure/card-statements.repository';
import {
  StatementImportsRepository,
  type StatementImportContext,
} from '../infrastructure/statement-imports.repository';
import { StatementImportReader } from './statement-import-reader';
import { STATEMENT_IMPORT_NOT_READY_MESSAGE } from './statement-import.constants';

type StatementImportApplierDeps = {
  reader: StatementImportReader;
  repo: StatementImportsRepository;
  createTransaction: CreateTransactionUseCase;
  adjustBalance: AdjustBalanceUseCase;
  cardStatements: CardStatementsRepository;
};

/** Applies a ready import: missing movements, balance adjustment and close. */
export class StatementImportApplier {
  constructor(private readonly deps: StatementImportApplierDeps) {}

  async apply(input: { userId: string; importId: string; adjust: boolean }) {
    const context = await this.deps.reader.context(
      input.userId,
      input.importId,
    );
    if (context.status === 'DISCARDED') {
      throw new ConflictException({
        message: 'La importación de estado de cuenta se descartó',
        code: STATEMENT_IMPORT_ERROR.DISCARDED,
      });
    }
    if (context.status === 'PARSING' || context.status === 'FAILED') {
      throw new ConflictException({
        message: STATEMENT_IMPORT_NOT_READY_MESSAGE,
        code: STATEMENT_IMPORT_ERROR.PARSE_FAILED,
      });
    }

    if (context.status !== 'APPLIED') {
      await this.createMissingTransactions(context);
      const parsed = readParsedStatement(context.parsed);
      if (input.adjust) {
        await this.applyAdjustment(context, parsed);
      }
      const statementId = await this.syncCardStatement(context, parsed);
      await this.deps.repo.markApplied({ importId: context.id, statementId });
    }
    return this.deps.reader.view(input.userId, input.importId);
  }

  async discard(userId: string, importId: string): Promise<void> {
    const context = await this.deps.reader.context(userId, importId);
    if (context.status === 'APPLIED') {
      throw new ConflictException({
        message: 'La importación de estado de cuenta ya se aplicó',
        code: STATEMENT_IMPORT_ERROR.ALREADY_APPLIED,
      });
    }
    await this.deps.repo.updateResult({
      importId,
      status: 'DISCARDED',
      error: null,
    });
  }

  private async createMissingTransactions(
    context: StatementImportContext,
  ): Promise<void> {
    for (const line of context.lines) {
      if (line.decision !== 'CREATE' || line.transactionId) {
        continue;
      }
      const created = await this.deps.createTransaction.execute(
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
      await this.deps.repo.linkLineTransaction(line.id, created.id);
    }
  }

  private async applyAdjustment(
    context: StatementImportContext,
    parsed: StatementImportParsed,
  ): Promise<void> {
    const closing = parsed.header.closingBalance;
    if (closing === null) {
      return;
    }
    if (context.accountId) {
      await this.deps.adjustBalance.execute(context.userId, {
        accountId: context.accountId,
        balance: closing,
      });
      return;
    }
    if (!context.cardId) {
      return;
    }
    const target = await this.deps.repo.findTargetBalance({
      userId: context.userId,
      cardId: context.cardId,
      accountId: null,
      currency: parsed.header.currency,
    });
    if (!target || target.creditLimit === null) {
      return;
    }
    await this.deps.adjustBalance.execute(context.userId, {
      cardId: context.cardId,
      currency: parsed.header.currency,
      balance: roundMoney(target.creditLimit - closing),
    });
  }

  private async syncCardStatement(
    context: StatementImportContext,
    parsed: StatementImportParsed,
  ): Promise<string | null> {
    if (!context.cardId || !parsed.period) {
      return null;
    }
    const cycleEnd = new Date(parsed.period.to);
    const closingBalance = parsed.header.closingBalance ?? 0;
    const statementId = await this.deps.cardStatements.upsertStatement({
      cardId: context.cardId,
      currency: parsed.header.currency,
      cycleStart: new Date(parsed.period.from),
      cycleEnd,
      dueDate: parsed.header.dueDate ? new Date(parsed.header.dueDate) : null,
      closingBalance,
      minimumPayment: parsed.header.minimumPayment ?? 0,
      minimumSource: parsed.header.minimumPayment === null ? null : 'IMPORTED',
      status: 'CLOSED',
    });
    await this.deps.cardStatements.recordStatementClosedEvent({
      userId: context.userId,
      cardId: context.cardId,
      statementId,
      currency: parsed.header.currency,
      cycleEnd,
      closingBalance,
    });
    return statementId;
  }
}
