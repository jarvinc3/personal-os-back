import {
  validateEmailClassification,
  type EmailClassification,
} from './email-classification.util';
import { groundBhdClassification } from './bhd-email-grounding';

const receivedAt = new Date('2026-11-06T15:12:00.000Z');

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
