import type { BhdEmailFixture } from '../helpers/bhd-import.harness';

/**
 * Matriz de QA sintética BHD (QA19). Reconstruye, con datos inventados, los
 * escenarios que el piloto BHD y su contrato de importación describen. Cada
 * caso declara de dónde sale y qué prueba lo ejecuta.
 *
 * QA19 = los 18 casos de este runner + CTR-02, que conserva su prueba de
 * integración desde #339.
 */
export const QA19_MATRIX_SPEC = 'qa19-bhd-matrix.integration-spec.ts';
export const CTR02_SPEC = 'ctr02-verification-idempotency.integration-spec.ts';
export const CTR02_TEST_TITLE =
  'CTR-02 idempotencia de verificaciones con DTO transformado';

export type Qa19Case = {
  id: string;
  title: string;
  source: readonly string[];
  coveredBy: string;
};

export const QA19_CASES: readonly Qa19Case[] = [
  {
    id: 'QA19-TRA-01',
    title: 'Transferencia recibida: una pata a favor del producto propio',
    source: ['#334', 'PR #340', 'email-import.md §3.2'],
    coveredBy: QA19_MATRIX_SPEC,
  },
  {
    id: 'QA19-TRA-02',
    title:
      'Transferencia entre productos: sale del origen sin contraparte inventada',
    source: ['#380 (punto 2)', '#370', 'email-import.md §3.2'],
    coveredBy: QA19_MATRIX_SPEC,
  },
  {
    id: 'QA19-TRA-03',
    title: 'Doble aviso de la misma transferencia: un solo movimiento',
    source: ['#380 (punto 1)', 'email-import.md §3.3'],
    coveredBy: QA19_MATRIX_SPEC,
  },
  {
    id: 'QA19-TRA-04',
    title: 'Transferencia con cuenta desconocida queda en revisión',
    source: ['email-import.md §3.1, §3.6'],
    coveredBy: QA19_MATRIX_SPEC,
  },
  {
    id: 'QA19-COM-01',
    title: 'Compra con tarjeta propia registra el gasto en la tarjeta',
    source: ['#343', '#370', 'email-import.md §1'],
    coveredBy: QA19_MATRIX_SPEC,
  },
  {
    id: 'QA19-COM-02',
    title: 'Compra en dólares conserva monto y tasa del ledger',
    source: ['#379', 'email-import.md §9'],
    coveredBy: QA19_MATRIX_SPEC,
  },
  {
    id: 'QA19-COM-03',
    title: 'Compra con tarjeta desconocida queda en revisión sin movimiento',
    source: ['email-import.md §5.3'],
    coveredBy: QA19_MATRIX_SPEC,
  },
  {
    id: 'QA19-COM-04',
    title: 'Compra sin comercio se registra marcada como desconocida',
    source: ['PR #345', 'email-import.md §5.4'],
    coveredBy: QA19_MATRIX_SPEC,
  },
  {
    id: 'QA19-PAG-01',
    title:
      'Pago de tarjeta confirmado desde correo crea la operación de dos patas',
    source: ['#335', 'email-import.md §4'],
    coveredBy: QA19_MATRIX_SPEC,
  },
  {
    id: 'QA19-PAG-02',
    title: 'Un aviso de pago de tarjeta sin confirmar no crea movimiento',
    source: ['#335', 'email-import.md §4.1, §8.1'],
    coveredBy: QA19_MATRIX_SPEC,
  },
  {
    id: 'QA19-DAT-01',
    title: 'Aviso de estado de cuenta no crea movimiento',
    source: ['#370', 'email-import.md §1'],
    coveredBy: QA19_MATRIX_SPEC,
  },
  {
    id: 'QA19-DAT-02',
    title:
      'Correo sin transacción no se confunde con un fallo de clasificación',
    source: ['#380 (punto 4)', 'email-import.md §11.4'],
    coveredBy: QA19_MATRIX_SPEC,
  },
  {
    id: 'QA19-DAT-03',
    title:
      'Fallo del proveedor de inferencia queda como clasificación no disponible',
    source: ['#380 (punto 4)', 'email-import.md §11.4'],
    coveredBy: QA19_MATRIX_SPEC,
  },
  {
    id: 'QA19-DAT-04',
    title: 'La fecha del correo solo sugiere la fecha de operación',
    source: ['#337', 'PR #341', 'email-import.md §5.1'],
    coveredBy: QA19_MATRIX_SPEC,
  },
  {
    id: 'QA19-REV-01',
    title: 'Reverso por referencia revierte su compra',
    source: ['#336', 'PR #345', 'email-import.md §6.1'],
    coveredBy: QA19_MATRIX_SPEC,
  },
  {
    id: 'QA19-REV-02',
    title: 'Reverso sin compra se vincula cuando la compra aparece',
    source: ['#380 (punto 3)', 'email-import.md §6.1'],
    coveredBy: QA19_MATRIX_SPEC,
  },
  {
    id: 'QA19-REV-03',
    title: 'Reverso sin comercio resuelve la tarjeta y su cuenta',
    source: ['#369', 'email-import.md §6.3'],
    coveredBy: QA19_MATRIX_SPEC,
  },
  {
    id: 'QA19-REV-04',
    title: 'Reverso parcial baja el gasto y conserva el monto original',
    source: ['#336', 'PR #345', 'email-import.md §6.6'],
    coveredBy: QA19_MATRIX_SPEC,
  },
  {
    id: 'CTR-02',
    title: 'Una verificación repetida no crea una segunda fila',
    source: ['#333', '#339'],
    coveredBy: CTR02_SPEC,
  },
];

const BHD_UTC_OFFSET_MS = 4 * 60 * 60 * 1_000;
const ALERTS_SENDER = 'Alertas@bhd.com.do';
const NOTIFICATIONS_SENDER = 'Notificaciones@bhd.com.do';
const SERVICES_SENDER = 'servicios@bhd.com.do';
const SYNTHETIC_CARD = '1111';
const SYNTHETIC_ACCOUNT = '1111';

type CardAlertInput = {
  messageId: string;
  transactionDate: string;
  amount: string;
  currency: 'DOP' | 'USD';
  cardLast4?: string;
  merchant?: string | null;
  status?: 'Aprobada' | 'Reversada' | 'Rechazada' | 'Pendiente';
  receivedAt?: string;
};

/** Alerta de tarjeta con la tabla que el lector fijo de BHD espera. */
export function cardAlertEmail({
  messageId,
  transactionDate,
  amount,
  currency,
  cardLast4 = SYNTHETIC_CARD,
  merchant = 'COMERCIO SINTÉTICO',
  status = 'Aprobada',
  receivedAt,
}: CardAlertInput): BhdEmailFixture {
  const merchantRow = merchant ? `${merchant}\n` : '';
  const text = [
    'BHD Notificación de Transacciones',
    `Visa Premia # ${cardLast4}`,
    'Detalle de Criterios',
    `Te notificamos la transacción realizada con tu Tarjeta Visa Premia # ${cardLast4}`,
    '',
    'En caso de no reconocer esta transacción, por favor llama de inmediato al 809-243-5282.',
    'Detalle de Transacciones',
    'Fecha',
    'Moneda',
    'Monto',
    'Comercio',
    'Estado',
    'Tipo',
    formatBhdDate({ isoDate: transactionDate, meridiemCase: 'lower' }),
    currency === 'DOP' ? 'RD' : 'US',
    `$${amount}`,
    merchantRow + status,
    'Compra',
    '',
    'Ahora, tus Tarjetas BHD cuentan con un nuevo sistema de seguridad para tus compras por internet.',
  ]
    .filter((line) => line.length > 0)
    .join('\n');
  return {
    messageId,
    from: ALERTS_SENDER,
    subject: 'BHD Notificación de Transacciones',
    date: receivedAt ?? minutesAfter(transactionDate, 2),
    text,
  };
}

type OwnProductsInput = {
  messageId: string;
  transactionDate: string;
  originLast4: string;
  destinationLast4: string;
  amount: string;
  reference: string;
  receivedAt?: string;
};

/** Transferencia entre productos propios, incluido el pago a una tarjeta. */
export function ownProductsTransferEmail({
  messageId,
  transactionDate,
  originLast4,
  destinationLast4,
  amount,
  reference,
  receivedAt,
}: OwnProductsInput): BhdEmailFixture {
  const text = [
    'Estimado(a): TITULAR DE PRUEBA',
    'A continuación la información relacionada a tu transacción:',
    `Producto origen: XXXXXXX${originLast4}`,
    `Producto destino: XXXXXXX${destinationLast4}`,
    'Descripción:',
    `Monto: RD$ ${amount}`,
    'Beneficiario: CTA DE AHORRO MÓVIL',
    `Número de confirmación: ${reference}`,
    `Fecha y hora de la transacción: ${formatBhdDate({
      isoDate: transactionDate,
      meridiemCase: 'upper',
      withDash: true,
    })}`,
    'Tipo de transacción: Transacciones entre mis productos',
    'Nota: Este correo electrónico es generado de manera automática por el sistema.',
    'Cordialmente, Banco BHD',
  ].join(' ');
  return {
    messageId,
    from: ALERTS_SENDER,
    subject: 'Transacciones entre mis productos',
    date: receivedAt ?? minutesAfter(transactionDate, 2),
    text,
  };
}

type IncomingTransferInput = {
  messageId: string;
  transactionDate: string;
  accountLast4?: string;
  amount: string;
  orderer?: string;
  receivedAt?: string;
};

/** Transferencia recibida desde otro banco. */
export function incomingTransferEmail({
  messageId,
  transactionDate,
  accountLast4 = SYNTHETIC_ACCOUNT,
  amount,
  orderer = 'ORDENANTE SINTÉTICO',
  receivedAt,
}: IncomingTransferInput): BhdEmailFixture {
  const text = [
    'Estimado(a): TITULAR DE PRUEBA',
    'Has recibido una transferencia de Pago al Instante.',
    'A continuación, el detalle de la transacción:',
    `Producto : DO26BCBHXXXXXXXXXXXXXXXX${accountLast4}`,
    'Tipo de producto: CUENTA DE AHORRO',
    'Banco Origen: BANCO SINTÉTICO, C. POR A.',
    `Ordenante: ${orderer}`,
    `Monto: RD$${amount}`,
    `Fecha y hora de la transacción: ${formatBhdDate({ isoDate: transactionDate, meridiemCase: 'upper' })}`,
    'Nota: Este correo electrónico es generado de manera automática por el sistema.',
    'Cordialmente, Banco BHD',
  ].join(' ');
  return {
    messageId,
    from: NOTIFICATIONS_SENDER,
    subject: 'Notificaciones',
    date: receivedAt ?? minutesAfter(transactionDate, 2),
    text,
  };
}

/** Aviso de estado de cuenta disponible, sin cifras. */
export function statementNoticeEmail({
  messageId,
  month,
  receivedAt,
}: {
  messageId: string;
  month: string;
  receivedAt: string;
}): BhdEmailFixture {
  return {
    messageId,
    from: SERVICES_SENDER,
    subject: `Ya están disponibles los estados de cuenta de ${month} de tu cuenta de ahorro en BHD`,
    date: receivedAt,
    text: `Ya están disponibles los estados de cuenta de ${month} de tu cuenta de ahorro en BHD. Ingresa a Internet Banking para consultarlos.`,
  };
}

/** Correo BHD fuera de los formatos fijos: lo atiende el modelo. */
export function serviceEmail({
  messageId,
  subject,
  text,
  receivedAt,
}: {
  messageId: string;
  subject: string;
  text: string;
  receivedAt: string;
}): BhdEmailFixture {
  return {
    messageId,
    from: 'info@bhd.com.do',
    subject,
    date: receivedAt,
    text,
  };
}

function formatBhdDate({
  isoDate,
  meridiemCase,
  withDash = false,
}: {
  isoDate: string;
  meridiemCase: 'lower' | 'upper';
  withDash?: boolean;
}): string {
  const local = new Date(Date.parse(isoDate) - BHD_UTC_OFFSET_MS);
  const day = String(local.getUTCDate()).padStart(2, '0');
  const month = String(local.getUTCMonth() + 1).padStart(2, '0');
  const year = local.getUTCFullYear();
  const hour = local.getUTCHours();
  const hour12 = String(hour % 12 === 0 ? 12 : hour % 12).padStart(2, '0');
  const minutes = String(local.getUTCMinutes()).padStart(2, '0');
  const meridiem = hour < 12 ? 'am' : 'pm';
  const label = meridiemCase === 'upper' ? meridiem.toUpperCase() : meridiem;
  const separator = withDash ? ' - ' : ' ';
  return `${day}/${month}/${year}${separator}${hour12}:${minutes} ${label}`;
}

function minutesAfter(isoDate: string, minutes: number): string {
  return new Date(Date.parse(isoDate) + minutes * 60_000).toISOString();
}
