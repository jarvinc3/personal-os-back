import {
  StatementPasswordError,
  type StatementPdfModule,
} from '../application/ports/statement-pdf.port';
import {
  PdfjsStatementTextExtractor,
  joinTextItems,
} from './pdfjs-statement-text.extractor';

function textItem(text: string, xPosition: number, yPosition: number) {
  return { str: text, transform: [9, 0, 0, 9, xPosition, yPosition] };
}

function readableModule(destroy = jest.fn(() => Promise.resolve())) {
  const page = {
    getTextContent: jest.fn(() =>
      Promise.resolve({
        items: [
          textItem('Banco BHD - Estado de cuenta', 40, 750),
          textItem('Cuenta:', 40, 736),
          textItem('****3447', 90, 736),
          { type: 'beginMarkedContent' },
          textItem('SUPERMERCADO NACIONAL SRL', 40, 720),
          textItem('', 0, 720),
        ],
      }),
    ),
    cleanup: jest.fn(),
  };
  const document = {
    numPages: 1,
    getPage: jest.fn(() => Promise.resolve(page)),
  };
  const module: StatementPdfModule = {
    getDocument: jest.fn(() => ({
      promise: Promise.resolve(document),
      destroy,
    })),
  };
  return { module, destroy };
}

describe('joinTextItems', () => {
  it('keeps one row together and separates rows by height', () => {
    expect(
      joinTextItems([
        textItem('Cuenta:', 40, 736),
        textItem('****3447', 90, 736),
        textItem('Periodo: 09/2026', 40, 722),
      ]),
    ).toBe('Cuenta: ****3447\nPeriodo: 09/2026');
  });

  it('orders columns left to right and drops empty runs', () => {
    expect(
      joinTextItems([
        textItem(' B ', 90, 700),
        textItem('A', 40, 700),
        textItem('', 0, 700),
      ]),
    ).toBe('A B');
  });
});

describe('PdfjsStatementTextExtractor', () => {
  it('extracts the text of every page', async () => {
    const { module, destroy } = readableModule();
    const extractor = new PdfjsStatementTextExtractor(() =>
      Promise.resolve(module),
    );

    const text = await extractor.extractText({ bytes: new Uint8Array([1]) });

    expect(text).toBe(
      'Banco BHD - Estado de cuenta\nCuenta: ****3447\nSUPERMERCADO NACIONAL SRL',
    );
    expect(destroy).toHaveBeenCalled();
  });

  it('reports a missing or wrong password as StatementPasswordError', async () => {
    const destroy = jest.fn(() => Promise.resolve());
    const module: StatementPdfModule = {
      getDocument: jest.fn(() => ({
        promise: Promise.reject(
          Object.assign(new Error('password'), { name: 'PasswordException' }),
        ),
        destroy,
      })),
    };
    const extractor = new PdfjsStatementTextExtractor(() =>
      Promise.resolve(module),
    );

    await expect(
      extractor.extractText({ bytes: new Uint8Array([1]), password: 'wrong' }),
    ).rejects.toBeInstanceOf(StatementPasswordError);
    expect(destroy).toHaveBeenCalled();
  });

  it('accepts a readable document in assertReadable', async () => {
    const { module, destroy } = readableModule();
    const extractor = new PdfjsStatementTextExtractor(() =>
      Promise.resolve(module),
    );

    await extractor.assertReadable({ bytes: new Uint8Array([1]) });

    expect(destroy).toHaveBeenCalled();
  });
});
