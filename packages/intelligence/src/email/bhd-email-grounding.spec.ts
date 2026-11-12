import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  validateEmailClassification,
  type EmailClassification,
} from './email-classification.util';
import { groundBhdClassification } from './bhd-email-grounding';

const receivedAt = new Date('2026-11-06T15:12:00.000Z');
const FIXTURES_DIRECTORY = resolve(__dirname, '../../test/fixtures/bhd-emails');

type BhdEmailFixture = {
  subject: string;
  date: string;
  previewCase: string;
  text: string;
  expected: {
    movementClass: string;
    direction: string;
    amount: number;
    currency: string;
    transactionDate: string;
  };
};

function readBhdFixture(name: string): BhdEmailFixture {
  return JSON.parse(
    readFileSync(join(FIXTURES_DIRECTORY, name), 'utf8'),
  ) as BhdEmailFixture;
}

/**
 * Ancla el texto del correo sobre la propuesta del modelo que reproduce cada
 * caso del piloto, para comprobar que gana el texto.
 */
function groundModelProposal({
  fixture,
  transaction,
}: {
  fixture: BhdEmailFixture;
  transaction: Record<string, unknown>;
}): EmailClassification {
  return groundBhdClassification({
    classification: validateEmailClassification({
      relevance: true,
      semanticType: 'FIN_TRANSACTION',
      routes: ['FINANCE'],
      transaction: { kind: 'TRANSACTION', ...transaction },
      confidence: 0.9,
    }),
    fromDomain: 'bhd.com.do',
    subject: fixture.subject,
    body: fixture.text,
    receivedAt: new Date(fixture.date),
  });
}

function classification(
  overrides: Partial<NonNullable<EmailClassification['transaction']>> = {},
): EmailClassification {
  return validateEmailClassification({
    relevance: true,
    semanticType: 'FIN_TRANSACTION',
    routes: ['FINANCE'],
    transaction: {
      kind: 'TRANSACTION',
      amount: 138.79,
      currency: 'USD',
      transactionDate: '2026-06-11T11:12:00.000Z',
      direction: 'DEBIT',
      movementClass: 'PURCHASE',
      bankStatusNormalized: 'APPROVED',
      ...overrides,
    },
    confidence: 0.9,
  });
}

function ground({
  body,
  fromDomain = 'bhd.com.do',
  receivedAt: messageReceivedAt = receivedAt,
  transaction = {},
}: {
  body: string;
  fromDomain?: string;
  receivedAt?: Date;
  transaction?: Partial<NonNullable<EmailClassification['transaction']>>;
}): EmailClassification {
  return groundBhdClassification({
    classification: classification(transaction),
    fromDomain,
    subject: 'BHD Notificación de Transacciones',
    body,
    receivedAt: messageReceivedAt,
  });
}

describe('BHD email grounding', () => {
  it('reads day/month and the bank local time instead of the model date', () => {
    const grounded = ground({
      body: [
        'Monto:',
        'RD$ 757.62',
        'Fecha y hora de la transacción:',
        '06/11/2026 - 11:12 AM',
      ].join('\n'),
    });

    expect(grounded.transaction).toMatchObject({
      transactionDate: '2026-11-06T15:12:00.000Z',
      currency: 'DOP',
    });
    expect(grounded.transaction?.transactionDate).not.toBe(
      '2026-06-11T11:12:00.000Z',
    );
  });

  it('keeps the day and month of another BHD notification', () => {
    const grounded = ground({
      body: 'Fecha y hora de la transacción:\n05/11/2026 | 7:18 PM',
      receivedAt: new Date('2026-11-05T23:18:00.000Z'),
    });

    expect(grounded.transaction).toMatchObject({
      transactionDate: '2026-11-05T23:18:00.000Z',
    });
  });

  it('converts a 12-hour time and a table date to UTC', () => {
    const grounded = ground({
      body: [
        'Fecha',
        'Moneda',
        'Monto',
        'Comercio',
        'Estado',
        'Tipo',
        '12/10/2026 12:21 pm',
        'RD',
        '$75.50',
        'COMERCIO SINTETICO',
        'Aprobada',
        'Compra',
      ].join('\n'),
      receivedAt: new Date('2026-10-12T16:21:00.000Z'),
      transaction: {
        amount: 75.5,
        transactionDate: '2026-12-10T12:21:00.000Z',
        currency: 'USD',
      },
    });

    expect(grounded.transaction).toMatchObject({
      transactionDate: '2026-10-12T16:21:00.000Z',
      currency: 'DOP',
    });
  });

  it('drops an operation date that the text does not verify', () => {
    const grounded = ground({
      body: 'Fecha de la transacción: 06/11/2026',
    });

    expect(grounded.transaction).not.toHaveProperty('transactionDate');
  });

  it('drops an invalid calendar date', () => {
    const grounded = ground({
      body: 'Fecha y hora de la transacción: 31/02/2026 - 10:00 AM',
    });

    expect(grounded.transaction).not.toHaveProperty('transactionDate');
  });

  it('drops a date outside the window of the received message', () => {
    const grounded = ground({
      body: 'Fecha y hora de la transacción: 06/11/2025 - 11:12 AM',
    });

    expect(grounded.transaction).not.toHaveProperty('transactionDate');
  });

  it('prefers US$ from the text and records the model contradiction', () => {
    const grounded = ground({
      body: 'Monto: US$ 138.79',
      transaction: { currency: 'DOP' },
    });

    expect(grounded.transaction).toMatchObject({
      currency: 'USD',
      currencyEvidence: expect.stringContaining('el modelo propuso DOP'),
    });
  });

  it('drops a model currency when the BHD text does not declare one', () => {
    const grounded = ground({
      body: 'Monto: 138.79',
      transaction: { currency: 'USD' },
    });

    expect(grounded.transaction).not.toHaveProperty('currency');
  });

  it('forces a BHD reversal to REFUND instead of a purchase', () => {
    const grounded = ground({
      body: [
        'Fecha',
        'Moneda',
        'Monto',
        'Comercio',
        'Estado',
        'Tipo',
        '06/11/2026 11:12 am',
        'RD',
        '$138.79',
        'COMERCIO SINTETICO',
        'Aprobada',
        'Reverso',
      ].join('\n'),
    });

    expect(grounded.transaction).toMatchObject({
      kind: 'TRANSACTION',
      movementClass: 'REFUND',
      direction: 'CREDIT',
      bankStatusNormalized: 'REVERSED',
    });
  });

  it('does not force a reversal when the payment was not applied', () => {
    const grounded = ground({
      body: [
        'El pago de servicio no pudo ser aplicado.',
        'Motivo de rechazo:',
        'TRANSACCION REVERSADA, Balance de la Cuenta no es Suficiente para el Pago',
        'Monto: 50,000.00',
        'Fecha y hora: 03/10/2026 - 12:40:11 PM',
      ].join('\n'),
      transaction: { amount: 50_000 },
    });

    expect(grounded.transaction).toMatchObject({
      movementClass: 'PURCHASE',
      direction: 'DEBIT',
      bankStatusNormalized: 'APPROVED',
    });
  });

  it('does not mutate the classification it receives', () => {
    const input = classification();
    const snapshot = structuredClone(input);

    groundBhdClassification({
      classification: input,
      fromDomain: 'bhd.com.do',
      subject: 'BHD Notificación de Transacciones',
      body: 'Monto: RD$ 138.79\nFecha y hora: 06/11/2026 - 11:12 AM\nTipo: Reverso',
      receivedAt,
    });

    expect(input).toEqual(snapshot);
  });

  it('does not apply BHD rules to another sender', () => {
    const grounded = ground({
      body: 'Monto: RD$ 138.79\nFecha: 06/11/2026 11:12 am',
      fromDomain: 'example.com',
    });

    expect(grounded.transaction).toMatchObject({
      currency: 'USD',
      transactionDate: '2026-06-11T11:12:00.000Z',
    });
  });
});

describe('BHD preview v4 cases', () => {
  it('does not read a card purchase at a merchant as a card payment (#13)', () => {
    const fixture = readBhdFixture('consumo-tarjeta-compra-151-30.json');
    const grounded = groundModelProposal({
      fixture,
      transaction: {
        amount: 151.3,
        currency: 'DOP',
        direction: 'DEBIT',
        movementClass: 'CARD_PAYMENT',
        merchant: 'UBER*RIDES',
        bankStatusNormalized: 'APPROVED',
      },
    });

    expect(grounded.transaction).toMatchObject({
      movementClass: fixture.expected.movementClass,
      direction: fixture.expected.direction,
      amount: fixture.expected.amount,
      currency: fixture.expected.currency,
      transactionDate: fixture.expected.transactionDate,
    });
  });

  it('restores the direction of a card purchase that came without it (#4)', () => {
    const fixture = readBhdFixture('consumo-tarjeta-compra-178-71.json');
    const grounded = groundModelProposal({
      fixture,
      transaction: {
        amount: 178.71,
        currency: 'DOP',
        movementClass: 'PURCHASE',
        merchant: 'UBER*RIDES',
        bankStatusNormalized: 'APPROVED',
      },
    });

    expect(grounded.transaction).toMatchObject({
      movementClass: fixture.expected.movementClass,
      direction: fixture.expected.direction,
      amount: fixture.expected.amount,
      currency: fixture.expected.currency,
      transactionDate: fixture.expected.transactionDate,
    });
  });

  it('takes the side of a transfer between own products from its origin (#16)', () => {
    const fixture = readBhdFixture('transferencia-entre-productos-757-62.json');
    const grounded = groundModelProposal({
      fixture,
      transaction: {
        amount: 757.62,
        currency: 'DOP',
        direction: 'TRANSFER',
        movementClass: 'TRANSFER_IN',
        bankStatusNormalized: 'APPROVED',
      },
    });

    expect(grounded.transaction).toMatchObject({
      movementClass: fixture.expected.movementClass,
      direction: fixture.expected.direction,
      amount: fixture.expected.amount,
      currency: fixture.expected.currency,
      transactionDate: fixture.expected.transactionDate,
    });
  });

  it('keeps the card payment class the model read when the text states no purchase', () => {
    const fixture = readBhdFixture('transferencia-entre-productos-757-62.json');
    const grounded = groundModelProposal({
      fixture,
      transaction: {
        amount: 757.62,
        currency: 'DOP',
        direction: 'DEBIT',
        movementClass: 'CARD_PAYMENT',
      },
    });

    expect(grounded.transaction).toMatchObject({
      movementClass: 'CARD_PAYMENT',
      direction: 'DEBIT',
    });
  });

  it('does not read a card alert row that describes another amount', () => {
    const fixture = readBhdFixture('consumo-tarjeta-compra-151-30.json');
    const grounded = groundModelProposal({
      fixture,
      transaction: {
        amount: 12.5,
        currency: 'DOP',
        direction: 'DEBIT',
        movementClass: 'CARD_PAYMENT',
      },
    });

    expect(grounded.transaction).toMatchObject({
      movementClass: 'CARD_PAYMENT',
      direction: 'DEBIT',
    });
  });
});
