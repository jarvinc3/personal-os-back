import { STATEMENT_IMPORT_ERROR } from '../domain/statement-import-errors';
import { StatementImportProcessor } from './statement-import.processor';

function setup(options: { readError?: Error } = {}) {
  const processImport = { execute: jest.fn(() => Promise.resolve()) };
  const imports = { updateResult: jest.fn(() => Promise.resolve()) };
  const uploads = {
    read: jest.fn(() =>
      options.readError
        ? Promise.reject(options.readError)
        : Promise.resolve(new Uint8Array([1])),
    ),
    remove: jest.fn(() => Promise.resolve()),
  };
  const processor = new StatementImportProcessor(
    processImport as never,
    imports as never,
    uploads as never,
  );
  return { processImport, imports, uploads, processor };
}

const job = { data: { userId: 'user-1', importId: 'import-1' } } as never;

describe('StatementImportProcessor', () => {
  it('parses the stored file and removes it', async () => {
    const { processImport, uploads, processor } = setup();

    await processor.process(job);

    expect(processImport.execute).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', importId: 'import-1' }),
    );
    expect(uploads.remove).toHaveBeenCalledWith('import-1');
  });

  it('marks the import failed when the file cannot be read', async () => {
    const { processImport, imports, uploads, processor } = setup({
      readError: new Error('ENOENT'),
    });

    await processor.process(job);

    expect(processImport.execute).not.toHaveBeenCalled();
    expect(imports.updateResult).toHaveBeenCalledWith(
      expect.objectContaining({
        importId: 'import-1',
        status: 'FAILED',
        error: STATEMENT_IMPORT_ERROR.PARSE_FAILED,
      }),
    );
    expect(uploads.remove).toHaveBeenCalledWith('import-1');
  });
});
