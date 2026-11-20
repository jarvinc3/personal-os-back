import type { EmailClassification } from './email-classification.util';
import { validateEmailClassification } from './email-classification.util';
import {
  extractCurrencyFromText,
  groundClassificationCurrency,
} from './email-currency-grounding';

/** Textos sintéticos con la forma de los avisos del piloto, sin datos reales. */
const POPULAR_PAYROLL_TEXT = [
  'Aviso de depósito de nómina',
  'Se ha depositado a su cuenta la suma de RD$ 45,000.00 por concepto de nómina.',
  'Referencia: 000000001',
].join('\n');

const QIK_DEPOSIT_TEXT = [
  'Depósito ACH',
  'Se ha acreditado a su cuenta Qik un depósito de RD$ 6,000.00.',
  'Referencia: 000000002',
].join('\n');

function classification(
  overrides: Partial<NonNullable<EmailClassification['transaction']>> = {},
): EmailClassification {
  return validateEmailClassification({
    relevance: true,
    semanticType: 'FIN_TRANSACTION',
    routes: ['FINANCE'],
    transaction: {
      kind: 'TRANSACTION',
      amount: 45_000,
      currency: 'USD',
      direction: 'CREDIT',
      ...overrides,
    },
    confidence: 0.9,
  });
}

describe('extractCurrencyFromText', () => {
  it('lee RD$ del aviso de nómina de Popular', () => {
    expect(extractCurrencyFromText(POPULAR_PAYROLL_TEXT, 45_000)).toEqual({
      code: 'DOP',
      marker: 'RD$',
    });
  });

  it('lee RD$ del depósito de Qik', () => {
    expect(extractCurrencyFromText(QIK_DEPOSIT_TEXT, 6_000)).toEqual({
      code: 'DOP',
      marker: 'RD$',
    });
  });

  it('lee US$ de un aviso en dólares', () => {
    expect(extractCurrencyFromText('Monto: US$ 138.79', 138.79)).toEqual({
      code: 'USD',
      marker: 'US$',
    });
  });

  it('deja el marcador más cercano al monto', () => {
    expect(
      extractCurrencyFromText(
        'US$ 1.00 de otro cargo. Monto: RD$ 45,000.00',
        45_000,
      ),
    ).toEqual({ code: 'DOP', marker: 'RD$' });
  });

  it('no decide sin marcador', () => {
    expect(extractCurrencyFromText('Monto: 45,000.00', 45_000)).toBeNull();
  });

  it('no decide si dos monedas aparecen sin un monto que las separe', () => {
    expect(
      extractCurrencyFromText('RD$ 45,000.00 y US$ 100.00', undefined),
    ).toBeNull();
  });

  it('ignora un RD$ de otro importe lejos del monto', () => {
    expect(
      extractCurrencyFromText(`RD$ 10.00 ${'x'.repeat(60)} 45,000.00`, 45_000),
    ).toBeNull();
  });

  it('ignora RD y US lejos del monto', () => {
    expect(
      extractCurrencyFromText(`RD ${'x'.repeat(60)} 45,000.00`, 45_000),
    ).toBeNull();
  });
});

describe('groundClassificationCurrency', () => {
  it('ancla la nómina de Popular en DOP y registra la contradicción', () => {
    const grounded = groundClassificationCurrency({
      classification: classification(),
      subject: 'Aviso de depósito de nómina',
      body: POPULAR_PAYROLL_TEXT,
    });

    expect(grounded.transaction).toMatchObject({
      currency: 'DOP',
      currencyEvidence: expect.stringContaining('el modelo propuso USD'),
    });
  });

  it('ancla el depósito de Qik en DOP', () => {
    const grounded = groundClassificationCurrency({
      classification: classification({ amount: 6_000 }),
      subject: 'Depósito ACH',
      body: QIK_DEPOSIT_TEXT,
    });

    expect(grounded.transaction).toMatchObject({ currency: 'DOP' });
  });

  it('prefiere US$ del texto y registra la contradicción', () => {
    const grounded = groundClassificationCurrency({
      classification: classification({ amount: 138.79, currency: 'DOP' }),
      subject: 'Aviso de cargo',
      body: 'Monto: US$ 138.79',
    });

    expect(grounded.transaction).toMatchObject({
      currency: 'USD',
      currencyEvidence: expect.stringContaining('el modelo propuso DOP'),
    });
  });

  it('quita la moneda del modelo cuando el texto no la declara', () => {
    const grounded = groundClassificationCurrency({
      classification: classification(),
      subject: 'Aviso de cargo',
      body: 'Monto: 45,000.00',
    });

    expect(grounded.transaction).not.toHaveProperty('currency');
    expect(grounded.transaction).not.toHaveProperty('currencyEvidence');
  });

  it('no toca una clasificación sin transacción', () => {
    const withoutTransaction = validateEmailClassification({
      relevance: true,
      semanticType: 'FIN_ACCOUNT_NOTICE',
      routes: ['FINANCE'],
      confidence: 0.9,
    });

    expect(
      groundClassificationCurrency({
        classification: withoutTransaction,
        subject: 'Aviso',
        body: 'RD$ 45,000.00',
      }),
    ).toBe(withoutTransaction);
  });

  it('no muta la clasificación que recibe', () => {
    const input = classification();
    const snapshot = structuredClone(input);

    groundClassificationCurrency({
      classification: input,
      subject: 'Aviso de depósito de nómina',
      body: POPULAR_PAYROLL_TEXT,
    });

    expect(input).toEqual(snapshot);
  });
});
