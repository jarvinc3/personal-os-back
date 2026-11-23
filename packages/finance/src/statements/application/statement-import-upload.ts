import { Injectable } from '@nestjs/common';
import { StatementImportParsing } from './statement-import-parsing';
import {
  StatementImportRegistration,
  type StatementUploadFile,
} from './statement-import-registration';

export type { StatementUploadFile } from './statement-import-registration';

type StatementUploadInput = {
  userId: string;
  cardId: string | null;
  accountId: string | null;
  file: StatementUploadFile | undefined;
  password?: string;
};

/** Opens the uploaded PDF, validates it and queues or runs its parsing. */
@Injectable()
export class StatementImportUpload {
  constructor(
    private readonly registration: StatementImportRegistration,
    private readonly parsing: StatementImportParsing,
  ) {}

  async create(input: StatementUploadInput): Promise<{ importId: string }> {
    const { importId, bytes } = await this.registration.register(input);
    await this.parsing.start({
      userId: input.userId,
      importId,
      bytes,
      password: input.password,
    });
    return { importId };
  }
}
