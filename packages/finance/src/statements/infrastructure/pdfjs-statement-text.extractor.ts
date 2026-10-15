import { Inject, Injectable } from '@nestjs/common';
import {
  STATEMENT_PDF_LOADER,
  StatementPasswordError,
  type StatementPdfInput,
  type StatementPdfLoader,
  type StatementPdfTextPort,
} from '../application/ports/statement-pdf.port';

const Y_TOLERANCE = 2;

type PositionedText = { text: string; x: number; y: number };

export const loadPdfjsStatementModule: StatementPdfLoader = () =>
  import('pdfjs-dist/legacy/build/pdf.mjs');

function isPositionedText(item: unknown): item is {
  str: string;
  transform: number[];
} {
  return (
    typeof item === 'object' &&
    item !== null &&
    typeof (item as { str?: unknown }).str === 'string' &&
    Array.isArray((item as { transform?: unknown }).transform)
  );
}

/** Rebuilds visual rows: pdf.js returns glyph runs, not lines. */
export function joinTextItems(items: readonly unknown[]): string {
  const positioned: PositionedText[] = [];
  for (const item of items) {
    if (!isPositionedText(item) || item.str.length === 0) {
      continue;
    }
    positioned.push({
      text: item.str,
      x: item.transform[4] ?? 0,
      y: item.transform[5] ?? 0,
    });
  }
  positioned.sort((left, right) => right.y - left.y || left.x - right.x);

  const lines: string[] = [];
  let currentY: number | null = null;
  let currentLine: string[] = [];
  const flush = () => {
    lines.push(currentLine.join(' ').replace(/\s+/g, ' ').trim());
    currentLine = [];
  };
  for (const item of positioned) {
    if (currentY !== null && Math.abs(item.y - currentY) > Y_TOLERANCE) {
      flush();
    }
    currentY = item.y;
    currentLine.push(item.text);
  }
  if (currentLine.length > 0) {
    flush();
  }
  return lines.filter((line) => line.length > 0).join('\n');
}

function isPasswordFailure(error: unknown): boolean {
  return (error as { name?: string }).name === 'PasswordException';
}

@Injectable()
export class PdfjsStatementTextExtractor implements StatementPdfTextPort {
  constructor(
    @Inject(STATEMENT_PDF_LOADER)
    private readonly loadPdfjs: StatementPdfLoader,
  ) {}

  async extractText(input: StatementPdfInput): Promise<string> {
    const { document, destroy } = await this.open(input);
    try {
      const pages: string[] = [];
      for (
        let pageNumber = 1;
        pageNumber <= document.numPages;
        pageNumber += 1
      ) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        pages.push(joinTextItems(content.items));
        page.cleanup();
      }
      return pages.join('\n');
    } finally {
      await destroy();
    }
  }

  async assertReadable(input: StatementPdfInput): Promise<void> {
    const { destroy } = await this.open(input);
    await destroy();
  }

  private async open(input: StatementPdfInput) {
    const pdfjs = await this.loadPdfjs();
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(input.bytes),
      password: input.password,
      useSystemFonts: true,
    });
    try {
      const document = await loadingTask.promise;
      return { document, destroy: () => loadingTask.destroy() };
    } catch (error) {
      await loadingTask.destroy();
      if (isPasswordFailure(error)) {
        throw new StatementPasswordError('The statement PDF needs a password');
      }
      throw error;
    }
  }
}
