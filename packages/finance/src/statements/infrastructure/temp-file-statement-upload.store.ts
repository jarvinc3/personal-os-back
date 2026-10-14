import { Injectable } from '@nestjs/common';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const STATEMENT_UPLOAD_STORE = 'STATEMENT_UPLOAD_STORE';

export interface StatementUploadStore {
  write(input: { importId: string; bytes: Uint8Array }): Promise<void>;
  read(importId: string): Promise<Uint8Array>;
  remove(importId: string): Promise<void>;
}

const UPLOAD_DIR = join(tmpdir(), 'personal-os-statement-imports');

function uploadPath(importId: string): string {
  return join(UPLOAD_DIR, `${importId}.pdf`);
}

/**
 * Uploads live on disk only until the parse finishes: the file is never part
 * of the database and the queue only carries the import id.
 */
@Injectable()
export class TempFileStatementUploadStore implements StatementUploadStore {
  async write(input: { importId: string; bytes: Uint8Array }): Promise<void> {
    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(uploadPath(input.importId), input.bytes);
  }

  async read(importId: string): Promise<Uint8Array> {
    const buffer = await readFile(uploadPath(importId));
    return new Uint8Array(buffer);
  }

  async remove(importId: string): Promise<void> {
    await rm(uploadPath(importId), { force: true });
  }
}
