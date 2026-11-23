export const STATEMENT_IMPORT_JOB_NAME = 'parse-statement' as const;

/**
 * One attempt only: parsing failures are deterministic (wrong password, PDF
 * with no text) and the user re-uploads. Retrying would need the temp file to
 * survive, so the worker can delete it as soon as the attempt ends.
 */
export const STATEMENT_IMPORT_JOB_OPTIONS = {
  attempts: 1,
  removeOnComplete: true,
  removeOnFail: true,
} as const;

export const STATEMENT_UPLOAD_MAX_BYTES = 10_000_000;

export const STATEMENT_FILE_REQUIRED_MESSAGE = 'Archivo obligatorio';

export const STATEMENT_IMPORT_NOT_FOUND_MESSAGE =
  'Importación de estado de cuenta no encontrada';

export const STATEMENT_IMPORT_NOT_READY_MESSAGE =
  'La importación de estado de cuenta no está lista';
