import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { QueueNames, type StatementImportJob } from '@personal-os/core';
import { ProcessStatementImportUseCase } from '../application/process-statement-import.use-case';
import { STATEMENT_IMPORT_ERROR } from '../domain/statement-import-errors';
import { StatementImportsRepository } from './statement-imports.repository';
import {
  STATEMENT_UPLOAD_STORE,
  type StatementUploadStore,
} from './temp-file-statement-upload.store';

@Injectable()
@Processor(QueueNames.STATEMENT_IMPORT)
export class StatementImportProcessor extends WorkerHost {
  private readonly logger = new Logger(StatementImportProcessor.name);

  constructor(
    private readonly processImport: ProcessStatementImportUseCase,
    private readonly imports: StatementImportsRepository,
    @Inject(STATEMENT_UPLOAD_STORE)
    private readonly uploads: StatementUploadStore,
  ) {
    super();
  }

  async process(job: Job<StatementImportJob>): Promise<void> {
    const { userId, importId, password } = job.data;
    try {
      const bytes = await this.uploads.read(importId);
      await this.processImport.execute({ userId, importId, bytes, password });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Statement import ${importId} failed: ${message}`);
      await this.imports.updateResult({
        importId,
        status: 'FAILED',
        parsed: { failureReason: message },
        error: STATEMENT_IMPORT_ERROR.PARSE_FAILED,
      });
    } finally {
      await this.uploads.remove(importId);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<StatementImportJob>, error: Error): void {
    this.logger.error(
      `Statement import job ${job.id ?? 'unknown'} failed: ${error.message}`,
    );
  }
}
