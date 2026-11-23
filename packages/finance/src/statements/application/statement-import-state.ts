import { Injectable } from '@nestjs/common';
import {
  StatementImportsRepository,
  type StatementImportContext,
} from '../infrastructure/statement-imports.repository';
import type { StatementImportView } from './statement-import-mappers';
import { StatementImportReader } from './statement-import-reader';

/** Persisted state of an import: its context and the writes that change it. */
@Injectable()
export class StatementImportState {
  constructor(
    private readonly reader: StatementImportReader,
    private readonly repo: StatementImportsRepository,
  ) {}

  context(userId: string, importId: string): Promise<StatementImportContext> {
    return this.reader.context(userId, importId);
  }

  view(userId: string, importId: string): Promise<StatementImportView> {
    return this.reader.view(userId, importId);
  }

  updateLine(input: {
    importId: string;
    lineId: string;
    decision: 'MATCH' | 'CREATE' | 'IGNORE';
    transactionId: string | null;
  }): Promise<number> {
    return this.repo.updateLine(input);
  }

  markApplied(input: {
    importId: string;
    statementId: string | null;
  }): Promise<void> {
    return this.repo.markApplied(input);
  }

  discard(importId: string): Promise<void> {
    return this.repo.updateResult({
      importId,
      status: 'DISCARDED',
      error: null,
    });
  }

  linkLineTransaction(lineId: string, transactionId: string): Promise<void> {
    return this.repo.linkLineTransaction(lineId, transactionId);
  }

  findTargetBalance(input: {
    userId: string;
    cardId: string | null;
    accountId: string | null;
    currency: string;
  }) {
    return this.repo.findTargetBalance(input);
  }
}
