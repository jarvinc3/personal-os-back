import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { STATEMENT_IMPORT_ERROR } from '../domain/statement-import-errors';
import { StatementImportsRepository } from '../infrastructure/statement-imports.repository';
import {
  STATEMENT_PDF_TEXT,
  StatementPasswordError,
  type StatementPdfTextPort,
} from './ports/statement-pdf.port';
import { STATEMENT_FILE_REQUIRED_MESSAGE } from './statement-import.constants';

export type StatementUploadFile = {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
};

type StatementRegistrationInput = {
  userId: string;
  cardId: string | null;
  accountId: string | null;
  file: StatementUploadFile | undefined;
  password?: string;
};

type RegisteredStatement = {
  importId: string;
  bytes: Uint8Array;
};

/** Validates the uploaded PDF and opens the import row for it. */
@Injectable()
export class StatementImportRegistration {
  constructor(
    private readonly repo: StatementImportsRepository,
    private readonly ownership: FinanceOwnershipService,
    @Inject(STATEMENT_PDF_TEXT)
    private readonly pdfText: StatementPdfTextPort,
  ) {}

  async register(
    input: StatementRegistrationInput,
  ): Promise<RegisteredStatement> {
    if (!input.file || input.file.buffer.length === 0) {
      throw new BadRequestException(STATEMENT_FILE_REQUIRED_MESSAGE);
    }
    if (input.cardId) {
      await this.ownership.assertCardOwned(input.userId, input.cardId);
    } else if (input.accountId) {
      await this.ownership.assertAccountOwned(input.userId, input.accountId);
    } else {
      throw new BadRequestException(
        'La importación de estado de cuenta necesita un destino',
      );
    }

    const bytes = new Uint8Array(input.file.buffer);
    await this.assertPasswordAccepted(bytes, input.password);

    const row = await this.repo.createImport({
      userId: input.userId,
      cardId: input.cardId,
      accountId: input.accountId,
    });
    return { importId: row.id, bytes };
  }

  private async assertPasswordAccepted(
    bytes: Uint8Array,
    password: string | undefined,
  ): Promise<void> {
    try {
      await this.pdfText.assertReadable({ bytes, password });
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
