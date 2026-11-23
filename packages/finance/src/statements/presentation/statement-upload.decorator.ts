import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { StatementUploadFile } from '../application/statement-imports.service';

export type StatementUploadInput = {
  file: StatementUploadFile | undefined;
  password?: string;
};

type StatementUploadRequest = {
  file?: StatementUploadFile;
  body?: { password?: string };
};

/** Reads the multipart file and its optional password in one parameter. */
export const StatementUpload = createParamDecorator(
  (_data: unknown, context: ExecutionContext): StatementUploadInput => {
    const request = context.switchToHttp().getRequest<StatementUploadRequest>();
    return { file: request.file, password: request.body?.password };
  },
);
