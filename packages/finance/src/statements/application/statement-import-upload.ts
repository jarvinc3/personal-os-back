import { BadRequestException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { StatementImportJob } from '@personal-os/core';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { STATEMENT_IMPORT_ERROR } from '../domain/statement-import-errors';
import { StatementImportsRepository } from '../infrastructure/statement-imports.repository';
import type { StatementUploadStore } from '../infrastructure/temp-file-statement-upload.store';
import {
  StatementPasswordError,
  type StatementPdfTextPort,
} from './ports/statement-pdf.port';
import { ProcessStatementImportUseCase } from './process-statement-import.use-case';
import {
  STATEMENT_FILE_REQUIRED_MESSAGE,
  STATEMENT_IMPORT_JOB_NAME,
  STATEMENT_IMPORT_JOB_OPTIONS,
} from './statement-import.constants';

export type StatementUploadFile = {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
};

type StatementUploadInput = {
  userId: string;
  cardId: string | null;
  accountId: string | null;
  file: StatementUploadFile | undefined;
  password?: string;
};

type StatementImportUploadDeps = {
  repo: StatementImportsRepository;
  ownership: FinanceOwnershipService;
  processImport: ProcessStatementImportUseCase;
  pdfText: StatementPdfTextPort;
  uploads: StatementUploadStore;
  queue?: Queue<StatementImportJob>;
};

/** Opens the uploaded PDF, validates it and queues or runs its parsing. */
export class StatementImportUpload {
  constructor(private readonly deps: StatementImportUploadDeps) {}

  async create(input: StatementUploadInput): Promise<{ importId: string }> {
    if (!input.file || input.file.buffer.length === 0) {
      throw new BadRequestException(STATEMENT_FILE_REQUIRED_MESSAGE);
    }
    if (input.cardId) {
      await this.deps.ownership.assertCardOwned(input.userId, input.cardId);
    } else if (input.accountId) {
      await this.deps.ownership.assertAccountOwned(
        input.userId,
        input.accountId,
      );
    } else {
      throw new BadRequestException(
        'La importación de estado de cuenta necesita un destino',
      );
    }

    const bytes = new Uint8Array(input.file.buffer);
    await this.assertPasswordAccepted(bytes, input.password);

    const row = await this.deps.repo.createImport({
      userId: input.userId,
      cardId: input.cardId,
      accountId: input.accountId,
    });
    if (this.deps.queue) {
      await this.deps.uploads.write({ importId: row.id, bytes });
      await this.deps.queue.add(
        STATEMENT_IMPORT_JOB_NAME,
        {
          userId: input.userId,
          importId: row.id,
          ...(input.password ? { password: input.password } : {}),
        },
        STATEMENT_IMPORT_JOB_OPTIONS,
      );
      return { importId: row.id };
    }

    await this.deps.processImport.execute({
      userId: input.userId,
      importId: row.id,
      bytes,
      password: input.password,
    });
    return { importId: row.id };
  }

  private async assertPasswordAccepted(
    bytes: Uint8Array,
    password: string | undefined,
  ): Promise<void> {
    try {
      await this.deps.pdfText.assertReadable({ bytes, password });
    } catch (error) {
      if (error instanceof StatementPasswordError) {
        throw new BadRequestException({
          message: 'El PDF del estado de cuenta necesita su contraseña',
          code: STATEMENT_IMPORT_ERROR.PASSWORD_REQUIRED,
        });
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException({
        message,
        code: STATEMENT_IMPORT_ERROR.PARSE_FAILED,
      });
    }
  }
}
