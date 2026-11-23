import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QueueNames, type StatementImportJob } from '@personal-os/core';
import {
  STATEMENT_UPLOAD_STORE,
  type StatementUploadStore,
} from '../infrastructure/temp-file-statement-upload.store';
import { ProcessStatementImportUseCase } from './process-statement-import.use-case';
import {
  STATEMENT_IMPORT_JOB_NAME,
  STATEMENT_IMPORT_JOB_OPTIONS,
} from './statement-import.constants';

type StatementParseStart = {
  userId: string;
  importId: string;
  bytes: Uint8Array;
  password?: string;
};

/** Starts the parse of a registered import: the queue if present, inline otherwise. */
@Injectable()
export class StatementImportParsing {
  constructor(
    private readonly processImport: ProcessStatementImportUseCase,
    @Inject(STATEMENT_UPLOAD_STORE)
    private readonly uploads: StatementUploadStore,
    @Optional()
    @InjectQueue(QueueNames.STATEMENT_IMPORT)
    private readonly queue?: Queue<StatementImportJob>,
  ) {}

  async start(input: StatementParseStart): Promise<void> {
    if (this.queue) {
      await this.uploads.write({
        importId: input.importId,
        bytes: input.bytes,
      });
      await this.queue.add(
        STATEMENT_IMPORT_JOB_NAME,
        {
          userId: input.userId,
          importId: input.importId,
          ...(input.password ? { password: input.password } : {}),
        },
        STATEMENT_IMPORT_JOB_OPTIONS,
      );
      return;
    }

    await this.processImport.execute({
      userId: input.userId,
      importId: input.importId,
      bytes: input.bytes,
      password: input.password,
    });
  }
}
