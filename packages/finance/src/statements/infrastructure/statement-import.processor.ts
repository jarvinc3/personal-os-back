import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { QueueNames, type StatementImportJob } from '@personal-os/core';
import { ProcessStatementImportUseCase } from '../application/process-statement-import.use-case';
import {
  STATEMENT_UPLOAD_STORE,
  type StatementUploadStore,
} from '../infrastructure/temp-file-statement-upload.store';

@Injectable()
@Processor(QueueNames.STATEMENT_IMPORT)
export class StatementImportProcessor extends WorkerHost {
  private readonly logger = new Logger(StatementImportProcessor.name);

  constructor(
    private readonly processImport: ProcessStatementImportUseCase,
    @Inject(STATEMENT_UPLOAD_STORE)
    private readonly uploads: StatementUploadStore,
  ) {
    super();
  }

  async process(job: Job<StatementImportJob>): Promise<void> {
    const { userId, importId, filePath, password } = job.data;
    try {
      const bytes = await this.uploads.read(filePath);
      await this.processImport.execute({ userId, importId, bytes, password });
    } finally {
      await this.uploads.remove(filePath);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<StatementImportJob>, error: Error): void {
    this.logger.error(
      `Statement import job ${job.id ?? 'unknown'} failed: ${error.message}`,
    );
  }
}
