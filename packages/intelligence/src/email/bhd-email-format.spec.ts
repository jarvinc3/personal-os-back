import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { EmailProductHints } from '@personal-os/contracts';
import { parseBhdFixedFormat } from './bhd-email-format';

const FIXTURES_DIRECTORY = resolve(__dirname, '../../test/fixtures/bhd-emails');

const noProducts: EmailProductHints = { cardLast4: [], accountLast4: [] };

type BhdEmailFixture = {
  from: string;
  subject: string;
  date: string;
  text: string;
};

function readFixture(name: string): BhdEmailFixture {
  return JSON.parse(
    readFileSync(join(FIXTURES_DIRECTORY, name), 'utf8'),
  ) as BhdEmailFixture;
}

function parse({
  fixture = readFixture('consumo-tarjeta-compra-151-30.json'),
  productHints = noProducts,
  subject,
  body,
  fromDomain = 'bhd.com.do',
  receivedAt,
}: {
  fixture?: BhdEmailFixture;
  productHints?: EmailProductHints | null;
  subject?: string;
  body?: string;
  fromDomain?: string;
  receivedAt?: Date;
} = {}) {
  return parseBhdFixedFormat({
    fromDomain,
    subject: subject ?? fixture.subject,
    body: body ?? fixture.text,
    receivedAt: receivedAt ?? new Date(fixture.date),
    productHints,
  });
}

describe('parseBhdFixedFormat', () => {
  it('reads a card purchase and does not depend on any provider', () => {
    expect(parse().transaction).toMatchObject({
      kind: 'TRANSACTION',
      amount: 151.3,
      currency: 'DOP',
      transactionDate: '2026-11-06T15:44:00.000Z',
      direction: 'DEBIT',
      movementClass: 'PURCHASE',
      bankStatusNormalized: 'APPROVED',
      merchant: 'UBER*RIDES',
      last4: '0000',
    });
  });

  it('reads a card purchase whose text arrives with html entities', () => {
    const parsed = parse({
      body: [
        'BHD Notificaci&oacute;n de Transacciones Visa Premia # 0000',
        'Detalle de Transacciones',
        '06/11/2026 11:44 am RD $151.30 UBER*RIDES Aprobada Compra',
      ].join(' '),
    });

    expect(parsed?.transaction).toMatchObject({
      amount: 151.3,
      movementClass: 'PURCHASE',
      direction: 'DEBIT',
    });
  });

  it('reads a reversal as a refund even when the type column says Compra', () => {
    const parsed = parse({
      body: [
        'BHD Notificación de Transacciones Visa Premia # 0000',
        'Detalle de Transacciones',
        '06/11/2026 03:24 pm RD $138.79 Reversada Compra',
      ].join(' '),
    });

    expect(parsed?.transaction).toMatchObject({
      amount: 138.79,
      movementClass: 'REFUND',
      direction: 'CREDIT',
      bankStatusNormalized: 'REVERSED',
    });
    expect(parsed?.transaction?.merchant).toBeUndefined();
  });

  it('uses a fixed confidence so the result does not move between providers', () => {
    expect(parse()?.confidence).toBe(0.99);
    expect(parse()?.confidence).toBe(parse()?.confidence);
  });

  it('keeps the transfer side in the origin when the destination is an account', () => {
    const parsed = parse({
      fixture: readFixture('transferencia-entre-productos-757-62.json'),
      productHints: { cardLast4: ['6506'], accountLast4: ['0024'] },
    });

    expect(parsed?.transaction).toMatchObject({
      amount: 757.62,
      currency: 'DOP',
      transactionDate: '2026-11-06T15:12:00.000Z',
      movementClass: 'TRANSFER_OUT',
      direction: 'TRANSFER',
      accountNumberLast4: '0016',
      bankReference: 'M01-1111-2222-3333-4',
    });
  });

  it('reads a card payment when the destination is one of the cards', () => {
    const parsed = parse({
      body: [
        'Producto origen: XXXXXXX0016',
        'Producto destino: XXXXXXXXXXXX6506',
        'Descripción: Pago de saldo al corte',
        'Monto: RD$ 12,345.67',
        'Beneficiario: TITULAR DE PRUEBA',
        'Número de confirmación: M01-1111-2222-3333-4',
        'Fecha y hora de la transacción: 06/11/2026 - 10:14 AM',
      ].join(' '),
      subject: 'Transacciones entre mis productos',
      productHints: { cardLast4: ['6506'], accountLast4: [] },
      receivedAt: new Date('2026-11-06T14:14:36Z'),
    });

    expect(parsed?.transaction).toMatchObject({
      amount: 12345.67,
      movementClass: 'CARD_PAYMENT',
      direction: 'DEBIT',
      accountNumberLast4: '0016',
      last4: '6506',
    });
  });

  it('leaves the class undecided when the destination is not a known product', () => {
    const parsed = parse({
      fixture: readFixture('transferencia-entre-productos-757-62.json'),
    });

    expect(parsed?.transaction).toMatchObject({
      movementClass: 'OTHER',
      direction: 'TRANSFER',
      accountNumberLast4: '0016',
    });
  });

  it('does not classify the own products format without product hints', () => {
    expect(
      parse({
        fixture: readFixture('transferencia-entre-productos-757-62.json'),
        productHints: null,
      }),
    ).toBeNull();
  });

  it('reads an incoming transfer into the named product', () => {
    const parsed = parse({
      subject: 'Notificaciones',
      body: [
        'Has recibido una transferencia de Pago al Instante.',
        'Producto : DO26BCBHXXXXXXXXXXXXXXXX0016',
        'Tipo de producto: CUENTA DE AHORRO',
        'Banco Origen: BANCO POPULAR DOMINICANO, C. POR A.',
        'Ordenante: TITULAR DE PRUEBA',
        'Monto: RD$500.00',
        'Fecha y hora de la transacci&oacute;n: 06/11/2026 12:47 PM',
      ].join(' '),
      receivedAt: new Date('2026-11-06T16:47:29Z'),
    });

    expect(parsed?.transaction).toMatchObject({
      amount: 500,
      currency: 'DOP',
      transactionDate: '2026-11-06T16:47:00.000Z',
      movementClass: 'TRANSFER_IN',
      direction: 'TRANSFER',
      accountNumberLast4: '0016',
      merchant: 'TITULAR DE PRUEBA',
    });
  });

  it('reads a statement notice without a transaction', () => {
    const parsed = parse({
      subject:
        'Ya están disponibles los estados de cuenta de octubre de tu cuenta de ahorro en BHD',
      body: 'Ya están disponibles los estados de tus cuentas de ahorro correspondientes al mes de Octubre.',
      fromDomain: 'bhd.com.do',
    });

    expect(parsed).toMatchObject({
      semanticType: 'FIN_STATEMENT_NOTICE',
      relevance: true,
      routes: ['FINANCE'],
    });
    expect(parsed?.transaction).toBeUndefined();
  });

  it('leaves an unrecognized BHD email to the model', () => {
    expect(
      parse({
        subject: 'Modo Plus Friday activado',
        body: 'Solicita tu Tarjeta Preaprobada BHD y conoce las ofertas del mes.',
      }),
    ).toBeNull();
  });

  it('leaves a statement notice with amounts to the model', () => {
    expect(
      parse({
        subject: 'Ya están disponibles los estados de cuenta de octubre',
        body: 'Ya están disponibles tus estados. Monto: RD$ 1,000.00',
      }),
    ).toBeNull();
  });

  it('does not apply BHD formats to another sender', () => {
    expect(parse({ fromDomain: 'example.com' })).toBeNull();
  });
});

const CARD_ALERT_HEADER =
  'BHD Notificación de Transacciones Visa Premia # 0000 Detalle de Criterios Te notificamos la transacción realizada con tu Tarjeta Visa Premia # 0000 Detalle de Transacciones Fecha Moneda Monto Comercio Estado Tipo';

function cardAlert({
  rowDate,
  currency,
  amount,
  merchant,
  status,
  type,
}: {
  rowDate: string;
  currency: string;
  amount: string;
  merchant: string;
  status: string;
  type: string;
}): string {
  return `${CARD_ALERT_HEADER} ${rowDate} ${currency} $${amount}${merchant ? ` ${merchant}` : ''} ${status} ${type}`;
}

function ownProducts({
  origin,
  destination,
  amount,
  receivedAt,
}: {
  origin: string;
  destination: string;
  amount: string;
  receivedAt: string;
}): string {
  return [
    'A continuación la información relacionada a tu transacción:',
    `Producto origen: ${origin}`,
    `Producto destino: ${destination}`,
    'Descripción:',
    `Monto: RD$ ${amount}`,
    'Beneficiario: CTA DE AHORRO MÓVIL',
    'Número de confirmación: M01-1111-2222-3333-4',
    `Fecha y hora de la transacción: ${receivedAt}`,
    'Tipo de transacción: Transacciones entre mis productos',
  ].join(' ');
}

function incomingTransfer({
  product,
  amount,
  receivedAt,
}: {
  product: string;
  amount: string;
  receivedAt: string;
}): string {
  return [
    'Has recibido una transferencia de Pago al Instante.',
    `Producto : ${product}`,
    'Tipo de producto: CUENTA DE AHORRO',
    'Banco Origen: BANCO POPULAR DOMINICANO, C. POR A.',
    'Ordenante: CONTRAPARTE DE PRUEBA',
    `Monto: RD$${amount}`,
    `Fecha y hora de la transacción: ${receivedAt}`,
  ].join(' ');
}

/**
 * Los 20 correos del piloto BHD v5, con montos y comercios del piloto y sin
 * datos personales. Los formatos reconocidos no llaman al modelo, así que el
 * resultado es el mismo con cualquier proveedor.
 */
const PILOT_CASES: readonly {
  case: string;
  subject: string;
  body: string;
  receivedAt: string;
  expected: Record<string, unknown> | null;
}[] = [
  {
    case: '1',
    subject: 'BHD Notificación de Transacciones',
    body: cardAlert({
      rowDate: '08/11/2026 08:05 am',
      currency: 'US',
      amount: '59.99',
      merchant: 'PAYPAL *STEAM GAME',
      status: 'Aprobada',
      type: 'Compra',
    }),
    receivedAt: '2026-11-08T08:06:30.000Z',
    expected: {
      movementClass: 'PURCHASE',
      direction: 'DEBIT',
      amount: 59.99,
      currency: 'USD',
    },
  },
  {
    case: '2',
    subject:
      'Ya están disponibles los estados de cuenta de octubre de tu cuenta de ahorro en BHD',
    body: 'Ya están disponibles los estados de tus cuentas de ahorro correspondientes al mes de Octubre.',
    receivedAt: '2026-11-07T20:34:04.000Z',
    expected: { semanticType: 'FIN_STATEMENT_NOTICE' },
  },
  {
    case: '3',
    subject: 'BHD Notificación de Transacciones',
    body: cardAlert({
      rowDate: '06/11/2026 11:01 pm',
      currency: 'US',
      amount: '29.99',
      merchant: 'PAYPAL *STEAM GAME',
      status: 'Aprobada',
      type: 'Compra',
    }),
    receivedAt: '2026-11-06T23:02:10.000Z',
    expected: {
      movementClass: 'PURCHASE',
      direction: 'DEBIT',
      amount: 29.99,
      currency: 'USD',
    },
  },
  {
    case: '4',
    subject: 'BHD Notificación de Transacciones',
    body: cardAlert({
      rowDate: '06/11/2026 03:29 pm',
      currency: 'RD',
      amount: '178.71',
      merchant: 'UBER*RIDES',
      status: 'Aprobada',
      type: 'Compra',
    }),
    receivedAt: '2026-11-06T19:30:15.000Z',
    expected: {
      movementClass: 'PURCHASE',
      direction: 'DEBIT',
      amount: 178.71,
      currency: 'DOP',
    },
  },
  {
    case: '5',
    subject: 'BHD Notificación de Transacciones',
    body: cardAlert({
      rowDate: '06/11/2026 03:24 pm',
      currency: 'RD',
      amount: '138.79',
      merchant: '',
      status: 'Reversada',
      type: 'Compra',
    }),
    receivedAt: '2026-11-06T19:24:30.000Z',
    expected: {
      movementClass: 'REFUND',
      direction: 'CREDIT',
      amount: 138.79,
      currency: 'DOP',
    },
  },
  {
    case: '6',
    subject: 'BHD Notificación de Transacciones',
    body: cardAlert({
      rowDate: '06/11/2026 03:23 pm',
      currency: 'RD',
      amount: '138.79',
      merchant: 'UBER*RIDES',
      status: 'Aprobada',
      type: 'Compra',
    }),
    receivedAt: '2026-11-06T19:23:30.000Z',
    expected: {
      movementClass: 'PURCHASE',
      direction: 'DEBIT',
      amount: 138.79,
      currency: 'DOP',
    },
  },
  {
    case: '7',
    subject: 'BHD Notificación de Transacciones',
    body: cardAlert({
      rowDate: '06/11/2026 03:11 pm',
      currency: 'RD',
      amount: '895.00',
      merchant: 'PedidosYa*Helados',
      status: 'Aprobada',
      type: 'Compra',
    }),
    receivedAt: '2026-11-06T19:12:30.000Z',
    expected: {
      movementClass: 'PURCHASE',
      direction: 'DEBIT',
      amount: 895,
      currency: 'DOP',
    },
  },
  {
    case: '8',
    subject: 'Modo Plus Friday activado! Solicita tu Tarjeta Preaprobada BHD',
    body: 'Solicita tu Tarjeta Preaprobada BHD y conoce las ofertas Plus Friday de noviembre.',
    receivedAt: '2026-11-06T19:01:24.000Z',
    expected: null,
  },
  {
    case: '9',
    subject: 'BHD Notificación de Transacciones',
    body: cardAlert({
      rowDate: '06/11/2026 02:10 pm',
      currency: 'RD',
      amount: '770.00',
      merchant: 'HUMMUS GALERIA 360',
      status: 'Aprobada',
      type: 'Compra',
    }),
    receivedAt: '2026-11-06T18:10:30.000Z',
    expected: {
      movementClass: 'PURCHASE',
      direction: 'DEBIT',
      amount: 770,
      currency: 'DOP',
    },
  },
  {
    case: '10',
    subject: 'Transacciones entre mis productos',
    body: ownProducts({
      origin: 'XXXXXXX0016',
      destination: 'XXXXXXX0024',
      amount: '500.00',
      receivedAt: '06/11/2026 - 12:49 PM',
    }),
    receivedAt: '2026-11-06T16:49:02.000Z',
    expected: {
      movementClass: 'TRANSFER_OUT',
      direction: 'TRANSFER',
      amount: 500,
    },
  },
  {
    case: '11',
    subject: 'Notificaciones',
    body: incomingTransfer({
      product: 'DO26BCBHXXXXXXXXXXXXXXXX0016',
      amount: '500.00',
      receivedAt: '06/11/2026 12:47 PM',
    }),
    receivedAt: '2026-11-06T16:47:29.000Z',
    expected: {
      movementClass: 'TRANSFER_IN',
      direction: 'TRANSFER',
      amount: 500,
    },
  },
  {
    case: '12',
    subject: 'BHD Notificación de Transacciones',
    body: cardAlert({
      rowDate: '06/11/2026 12:09 pm',
      currency: 'RD',
      amount: '119.01',
      merchant: 'UBER*RIDES',
      status: 'Aprobada',
      type: 'Compra',
    }),
    receivedAt: '2026-11-06T16:10:30.000Z',
    expected: {
      movementClass: 'PURCHASE',
      direction: 'DEBIT',
      amount: 119.01,
      currency: 'DOP',
    },
  },
  {
    case: '13',
    subject: 'BHD Notificación de Transacciones',
    body: cardAlert({
      rowDate: '06/11/2026 11:44 am',
      currency: 'RD',
      amount: '151.30',
      merchant: 'UBER*RIDES',
      status: 'Aprobada',
      type: 'Compra',
    }),
    receivedAt: '2026-11-06T15:45:00.000Z',
    expected: {
      movementClass: 'PURCHASE',
      direction: 'DEBIT',
      amount: 151.3,
      currency: 'DOP',
    },
  },
  {
    case: '14',
    subject: 'Transacciones entre mis productos',
    body: ownProducts({
      origin: 'XXXXXXX0016',
      destination: 'XXXXXXX0024',
      amount: '1,000.00',
      receivedAt: '06/11/2026 - 11:18 AM',
    }),
    receivedAt: '2026-11-06T15:18:16.000Z',
    expected: {
      movementClass: 'TRANSFER_OUT',
      direction: 'TRANSFER',
      amount: 1000,
    },
  },
  {
    case: '15',
    subject: 'Notificaciones',
    body: incomingTransfer({
      product: 'DO26BCBHXXXXXXXXXXXXXXXX0016',
      amount: '1,000.00',
      receivedAt: '06/11/2026 11:16 AM',
    }),
    receivedAt: '2026-11-06T15:16:41.000Z',
    expected: {
      movementClass: 'TRANSFER_IN',
      direction: 'TRANSFER',
      amount: 1000,
    },
  },
  {
    case: '16',
    subject: 'Transacciones entre mis productos',
    body: ownProducts({
      origin: 'XXXXXXX0016',
      destination: 'XXXXXXX0024',
      amount: '757.62',
      receivedAt: '06/11/2026 - 11:12 AM',
    }),
    receivedAt: '2026-11-06T15:12:58.000Z',
    expected: {
      movementClass: 'TRANSFER_OUT',
      direction: 'TRANSFER',
      amount: 757.62,
    },
  },
  {
    case: '17',
    subject: 'BHD Notificación de Transacciones',
    body: cardAlert({
      rowDate: '06/11/2026 09:20 am',
      currency: 'RD',
      amount: '78.39',
      merchant: 'UBER*RIDES',
      status: 'Aprobada',
      type: 'Compra',
    }),
    receivedAt: '2026-11-06T13:20:30.000Z',
    expected: {
      movementClass: 'PURCHASE',
      direction: 'DEBIT',
      amount: 78.39,
      currency: 'DOP',
    },
  },
  {
    case: '18',
    subject: 'BHD Notificación de Transacciones',
    body: cardAlert({
      rowDate: '06/11/2026 08:44 am',
      currency: 'RD',
      amount: '106.68',
      merchant: 'UBER*RIDES',
      status: 'Aprobada',
      type: 'Compra',
    }),
    receivedAt: '2026-11-06T12:44:30.000Z',
    expected: {
      movementClass: 'PURCHASE',
      direction: 'DEBIT',
      amount: 106.68,
      currency: 'DOP',
    },
  },
  {
    case: '19',
    subject: 'BHD Notificación de Transacciones',
    body: cardAlert({
      rowDate: '05/11/2026 07:21 pm',
      currency: 'RD',
      amount: '700.00',
      merchant: 'PROCURADURIA - 625',
      status: 'Aprobada',
      type: 'Compra',
    }),
    receivedAt: '2026-11-05T23:22:30.000Z',
    expected: {
      movementClass: 'PURCHASE',
      direction: 'DEBIT',
      amount: 700,
      currency: 'DOP',
    },
  },
  {
    case: '20',
    subject: 'BHD Notificación de Transacciones',
    body: cardAlert({
      rowDate: '05/11/2026 07:18 pm',
      currency: 'RD',
      amount: '6.32',
      merchant: 'PROCURADURIA - 501',
      status: 'Aprobada',
      type: 'Compra',
    }),
    receivedAt: '2026-11-05T23:18:30.000Z',
    expected: {
      movementClass: 'PURCHASE',
      direction: 'DEBIT',
      amount: 6.32,
      currency: 'DOP',
    },
  },
];

/** Vista plana: los campos del movimiento al mismo nivel para la tabla. */
function comparableFields(
  value: ReturnType<typeof parseBhdFixedFormat>,
): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  return { ...value, ...value.transaction };
}

describe('BHD pilot v5 regression', () => {
  it.each(PILOT_CASES)(
    'classifies pilot case $case without asking a provider',
    ({ subject, body, receivedAt, expected }) => {
      const parsed = parseBhdFixedFormat({
        fromDomain: 'bhd.com.do',
        subject,
        body,
        receivedAt: new Date(receivedAt),
        productHints: { cardLast4: ['6506'], accountLast4: ['0016', '0024'] },
      });

      if (expected === null) {
        expect(parsed).toBeNull();
        return;
      }
      expect(comparableFields(parsed)).toMatchObject(expected);
    },
  );

  it('gives the same classification on repeated runs', () => {
    const run = () =>
      parseBhdFixedFormat({
        fromDomain: 'bhd.com.do',
        subject: PILOT_CASES[12].subject,
        body: PILOT_CASES[12].body,
        receivedAt: new Date(PILOT_CASES[12].receivedAt),
        productHints: noProducts,
      });

    expect(run()).toEqual(run());
  });
});

describe('BHD card alert status', () => {
  it('keeps a pending or declined alert from moving money', () => {
    const pending = parse({
      body: `${CARD_ALERT_HEADER} 06/11/2026 11:44 am RD $151.30 UBER*RIDES Pendiente Compra`,
    });
    const declined = parse({
      body: `${CARD_ALERT_HEADER} 06/11/2026 11:44 am RD $151.30 UBER*RIDES Rechazada Compra`,
    });

    expect(pending?.transaction).toMatchObject({
      kind: 'PENDING',
      bankStatusNormalized: 'PENDING',
      movementClass: 'PURCHASE',
      statusEvidence: 'Estado: Pendiente',
    });
    expect(declined?.transaction).toMatchObject({
      kind: 'TRANSACTION',
      bankStatusNormalized: 'DECLINED',
      movementClass: 'PURCHASE',
      statusEvidence: 'Estado: Rechazada',
    });
  });
});
