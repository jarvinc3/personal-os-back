import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QueueNames, type StatementImportJob } from '@personal-os/core';
import { AdjustBalanceUseCase } from '../../ledger/application/adjust-balance.use-case';
import { CreateTransactionUseCase } from '../../ledger/application/create-transaction.use-case';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { CardStatementsRepository } from '../infrastructure/card-statements.repository';
import { StatementImportsRepository } from '../infrastructure/statement-imports.repository';
import {
  STATEMENT_UPLOAD_STORE,
  type StatementUploadStore,
} from '../infrastructure/temp-file-statement-upload.store';
import { ProcessStatementImportUseCase } from './process-statement-import.use-case';
import {
  STATEMENT_PDF_TEXT,
  type StatementPdfTextPort,
} from './ports/statement-pdf.port';
import { StatementImportApplier } from './statement-import-applier';
import { StatementImportLines } from './statement-import-lines';
import { StatementImportReader } from './statement-import-reader';
import {
  StatementImportUpload,
  type StatementUploadFile,
} from './statement-import-upload';
import type { StatementImportView } from './statement-import-mappers';

export type { StatementUploadFile } from './statement-import-upload';

@Injectable()
export class StatementImportsService {
  private readonly uploader: StatementImportUpload;
  private readonly reader: StatementImportReader;
  private readonly lines: StatementImportLines;
  private readonly applier: StatementImportApplier;

  constructor(
    repo: StatementImportsRepository,
    ownership: FinanceOwnershipService,
    processImport: ProcessStatementImportUseCase,
    createTransaction: CreateTransactionUseCase,
    adjustBalance: AdjustBalanceUseCase,
    cardStatements: CardStatementsRepository,
    @Inject(STATEMENT_PDF_TEXT)
    pdfText: StatementPdfTextPort,
    @Inject(STATEMENT_UPLOAD_STORE)
    uploads: StatementUploadStore,
    @Optional()
    @InjectQueue(QueueNames.STATEMENT_IMPORT)
    queue?: Queue<StatementImportJob>,
  ) {
    this.reader = new StatementImportReader(repo);
    this.uploader = new StatementImportUpload({
      repo,
      ownership,
      processImport,
      pdfText,
      uploads,
      queue,
    });
    this.lines = new StatementImportLines({ reader: this.reader, repo });
    this.applier = new StatementImportApplier({
      reader: this.reader,
      repo,
      createTransaction,
      adjustBalance,
      cardStatements,
    });
  }

  createFromUpload(input: {
    userId: string;
    cardId: string | null;
    accountId: string | null;
    file: StatementUploadFile | undefined;
    password?: string;
  }): Promise<{ importId: string }> {
    return this.uploader.create(input);
  }

  getImport(userId: string, importId: string): Promise<StatementImportView> {
    return this.reader.view(userId, importId);
  }

  updateLine(input: {
    userId: string;
    importId: string;
    lineId: string;
    decision: 'MATCH' | 'CREATE' | 'IGNORE';
    transactionId?: string | null;
  }) {
    return this.lines.update(input);
  }

  apply(input: {
    userId: string;
    importId: string;
    adjust: boolean;
  }): Promise<StatementImportView> {
    return this.applier.apply(input);
  }

  discard(userId: string, importId: string): Promise<void> {
    return this.applier.discard(userId, importId);
  }
}
