import { Injectable } from '@nestjs/common';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const STATEMENT_UPLOAD_STORE = 'STATEMENT_UPLOAD_STORE';

export interface StatementUploadStore {
  save(input: { importId: string; bytes: Uint8Array }): Promise<string>;
  read(filePath: string): Promise<Uint8Array>;
  remove(filePath: string): Promise<void>;
}

const UPLOAD_DIR = join(tmpdir(), 'personal-os-statement-imports');

/**
 * Uploads live on disk only until the parse finishes: the file is never part
 * of the database and the queue only carries its path.
 */
@Injectable()
export class TempFileStatementUploadStore implements StatementUploadStore {
  async save(input: { importId: string; bytes: Uint8Array }): Promise<string> {
    await mkdir(UPLOAD_DIR, { recursive: true });
    const filePath = join(UPLOAD_DIR, `${input.importId}.pdf`);
    await writeFile(filePath, input.bytes);
    return filePath;
  }

  async read(filePath: string): Promise<Uint8Array> {
    const buffer = await readFile(filePath);
    return new Uint8Array(buffer);
  }

  async remove(filePath: string): Promise<void> {
    await rm(filePath, { force: true });
  }
}
