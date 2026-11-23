import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { readParsedStatement } from '../domain/statement-import-view';
import { STATEMENT_IMPORT_ERROR } from '../domain/statement-import-errors';
import { StatementImportLedgerWriter } from './statement-import-ledger-writer';
import { StatementImportState } from './statement-import-state';
import { StatementImportStatementSync } from './statement-import-statement-sync';
import { STATEMENT_IMPORT_NOT_READY_MESSAGE } from './statement-import.constants';

type StatementLineDecision = {
  userId: string;
  importId: string;
  lineId: string;
  decision: 'MATCH' | 'CREATE' | 'IGNORE';
  transactionId?: string | null;
};

/**
 * Command side of an import: the decision for one line, applying the ready
 * import and discarding it. The reads live in `StatementImportReader`.
 */
@Injectable()
export class StatementImportApplier {
  constructor(
    private readonly state: StatementImportState,
    private readonly ledger: StatementImportLedgerWriter,
    private readonly statements: StatementImportStatementSync,
  ) {}

  async updateLine(input: StatementLineDecision) {
    const context = await this.state.context(input.userId, input.importId);
    if (context.status !== 'READY') {
      throw new ConflictException({
        message: STATEMENT_IMPORT_NOT_READY_MESSAGE,
        code: STATEMENT_IMPORT_ERROR.ALREADY_APPLIED,
      });
    }
    const line = context.lines.find((entry) => entry.id === input.lineId);
    if (!line) {
      throw new NotFoundException('Línea del estado de cuenta no encontrada');
    }
    const transactionId = this.resolveTransactionId(input, line.transactionId);
    const updated = await this.state.updateLine({
      importId: input.importId,
      lineId: input.lineId,
      decision: input.decision,
      transactionId,
    });
    if (updated === 0) {
      throw new NotFoundException('Línea del estado de cuenta no encontrada');
    }
    return this.state.view(input.userId, input.importId);
  }

  async apply(input: { userId: string; importId: string; adjust: boolean }) {
    const context = await this.state.context(input.userId, input.importId);
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
      await this.ledger.createMissingTransactions(context);
      const parsed = readParsedStatement(context.parsed);
      if (input.adjust) {
        await this.ledger.applyAdjustment(context, parsed);
      }
      const statementId = await this.statements.sync(context, parsed);
      await this.state.markApplied({ importId: context.id, statementId });
    }
    return this.state.view(input.userId, input.importId);
  }

  async discard(userId: string, importId: string): Promise<void> {
    const context = await this.state.context(userId, importId);
    if (context.status === 'APPLIED') {
      throw new ConflictException({
        message: 'La importación de estado de cuenta ya se aplicó',
        code: STATEMENT_IMPORT_ERROR.ALREADY_APPLIED,
      });
    }
    await this.state.discard(importId);
  }

  private resolveTransactionId(
    input: StatementLineDecision,
    currentTransactionId: string | null,
  ): string | null {
    if (input.decision === 'CREATE') {
      return null;
    }
    if (input.decision === 'IGNORE') {
      // Keep the original link so re-checking the row restores the match.
      return currentTransactionId;
    }
    const transactionId = input.transactionId ?? currentTransactionId;
    if (!transactionId) {
      throw new BadRequestException(
        'Una conciliación requiere una transacción',
      );
    }
    return transactionId;
  }
}
