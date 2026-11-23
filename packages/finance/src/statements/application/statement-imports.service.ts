import { Injectable } from '@nestjs/common';
import { StatementImportApplier } from './statement-import-applier';
import type { StatementImportView } from './statement-import-mappers';
import { StatementImportReader } from './statement-import-reader';
import {
  StatementImportUpload,
  type StatementUploadFile,
} from './statement-import-upload';

export type { StatementUploadFile } from './statement-import-upload';

/** Public surface of statement imports: reads, upload and apply decisions. */
@Injectable()
export class StatementImportsService {
  constructor(
    private readonly reads: StatementImportReader,
    private readonly uploads: StatementImportUpload,
    private readonly applications: StatementImportApplier,
  ) {}

  createFromUpload(input: {
    userId: string;
    cardId: string | null;
    accountId: string | null;
    file: StatementUploadFile | undefined;
    password?: string;
  }): Promise<{ importId: string }> {
    return this.uploads.create(input);
  }

  getImport(userId: string, importId: string): Promise<StatementImportView> {
    return this.reads.view(userId, importId);
  }

  updateLine(input: {
    userId: string;
    importId: string;
    lineId: string;
    decision: 'MATCH' | 'CREATE' | 'IGNORE';
    transactionId?: string | null;
  }): Promise<StatementImportView> {
    return this.applications.updateLine(input);
  }

  apply(input: {
    userId: string;
    importId: string;
    adjust: boolean;
  }): Promise<StatementImportView> {
    return this.applications.apply(input);
  }

  discard(userId: string, importId: string): Promise<void> {
    return this.applications.discard(userId, importId);
  }
}
