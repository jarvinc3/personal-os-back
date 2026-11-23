import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { STATEMENT_IMPORT_ERROR } from '../domain/statement-import-errors';
import { StatementImportsRepository } from '../infrastructure/statement-imports.repository';
import { StatementImportReader } from './statement-import-reader';
import { STATEMENT_IMPORT_NOT_READY_MESSAGE } from './statement-import.constants';

type StatementLineDecision = {
  userId: string;
  importId: string;
  lineId: string;
  decision: 'MATCH' | 'CREATE' | 'IGNORE';
  transactionId?: string | null;
};

type StatementImportLinesDeps = {
  reader: StatementImportReader;
  repo: StatementImportsRepository;
};

/** Decides how one imported line is reconciled with a movement. */
export class StatementImportLines {
  constructor(private readonly deps: StatementImportLinesDeps) {}

  async update(input: StatementLineDecision) {
    const context = await this.deps.reader.context(
      input.userId,
      input.importId,
    );
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
    let transactionId: string | null;
    if (input.decision === 'CREATE') {
      transactionId = null;
    } else if (input.decision === 'IGNORE') {
      // Keep the original link so re-checking the row restores the match.
      transactionId = line.transactionId;
    } else {
      transactionId = input.transactionId ?? line.transactionId;
      if (!transactionId) {
        throw new BadRequestException(
          'Una conciliación requiere una transacción',
        );
      }
    }
    const updated = await this.deps.repo.updateLine({
      importId: input.importId,
      lineId: input.lineId,
      decision: input.decision,
      transactionId,
    });
    if (updated === 0) {
      throw new NotFoundException('Línea del estado de cuenta no encontrada');
    }
    return this.deps.reader.view(input.userId, input.importId);
  }
}
