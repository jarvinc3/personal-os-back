/** Raised when the PDF is encrypted and the given password is missing or wrong. */
export class StatementPasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StatementPasswordError';
  }
}

export type StatementPdfInput = {
  bytes: Uint8Array;
  password?: string;
};

export interface StatementPdfTextPort {
  /**
   * Opens the document and returns its text, one line per visual row. Throws
   * StatementPasswordError when the password is missing or wrong.
   */
  extractText(input: StatementPdfInput): Promise<string>;
  /** Cheap open+close used by the upload request to ask for the password early. */
  assertReadable(input: StatementPdfInput): Promise<void>;
}

export const STATEMENT_PDF_TEXT = Symbol('STATEMENT_PDF_TEXT');

export type StatementPdfPage = {
  getTextContent(): Promise<{ items: readonly unknown[] }>;
  cleanup(): void;
};

export type StatementPdfDocument = {
  numPages: number;
  getPage(pageNumber: number): Promise<StatementPdfPage>;
};

export type StatementPdfLoadingTask = {
  promise: Promise<StatementPdfDocument>;
  destroy(): Promise<void>;
};

export type StatementPdfModule = {
  getDocument(params: {
    data: Uint8Array;
    password?: string;
    useSystemFonts?: boolean;
  }): StatementPdfLoadingTask;
};

/**
 * pdf.js ships ESM only, so it is loaded lazily and behind a token: the loader
 * stays swappable in tests without pulling ESM into the CommonJS test runtime.
 */
export type StatementPdfLoader = () => Promise<StatementPdfModule>;

export const STATEMENT_PDF_LOADER = Symbol('STATEMENT_PDF_LOADER');
