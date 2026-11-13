import type { EmailProductHints } from '@personal-os/contracts';
import {
  CARD_ALERT_PURCHASE_TYPE,
  collapseWhitespace,
  extractBhdCurrency,
  extractBhdTransactionDate,
  isBhdEmail,
  readBhdCardAlertRow,
} from './bhd-email-grounding';
import {
  validateEmailClassification,
  type EmailClassification,
} from './email-classification.util';

/**
 * Los formatos fijos de BHD se leen del texto y no llaman al modelo: el banco
 * escribe los mismos campos siempre, y así el resultado no cambia cuando rota
 * el proveedor de IA. Un correo que no encaja en ninguno sigue el camino de
 * siempre.
 */
const BHD_FORMAT_CONFIDENCE = 0.99;

const FINANCE_ROUTE = 'FINANCE';

const OWN_PRODUCTS_ORIGIN_PATTERN = /producto origen:\s*(\S{4,40})/i;
const OWN_PRODUCTS_DESTINATION_PATTERN = /producto destino:\s*(\S{4,40})/i;
const CONFIRMATION_PATTERN = /n[uú]mero de confirmaci[oó]n:\s*(\S{6,60})/i;
const MONTO_PATTERN = /monto:\s*(?:RD\$|US\$)?\s*([\d.,]+)/i;
const INCOMING_PRODUCT_PATTERN = /producto\s*:\s*(\S{4,40})/i;
const INCOMING_TRANSFER_PATTERN = /has recibido una transferencia/i;
const INCOMING_SENDER_PATTERN = /ordenante:\s*(.{1,160}?)monto:/i;
const OWN_PRODUCTS_PATTERN = /producto origen:[\s\S]*producto destino:/i;
const STATEMENT_NOTICE_PATTERN =
  /ya est[aá]n disponibles los estados de cuenta/i;
const CARD_LAST4_PATTERN = /#\s*(\d{4})\b/;

const HTML_ENTITIES: Record<string, string> = {
  '&aacute;': 'á',
  '&eacute;': 'é',
  '&iacute;': 'í',
  '&oacute;': 'ó',
  '&uacute;': 'ú',
  '&ntilde;': 'ñ',
  '&uuml;': 'ü',
  '&Aacute;': 'Á',
  '&Eacute;': 'É',
  '&Iacute;': 'Í',
  '&Oacute;': 'Ó',
  '&Uacute;': 'Ú',
  '&Ntilde;': 'Ñ',
  '&amp;': '&',
  '&nbsp;': ' ',
  '&quot;': '"',
  '&#39;': "'",
  '&lt;': '<',
  '&gt;': '>',
};

type BhdFormatInput = {
  fromDomain: string | null | undefined;
  subject: string;
  body: string;
  receivedAt: Date;
  /** Productos propios; `null` cuando el dominio dueño no está disponible. */
  productHints: EmailProductHints | null;
};

type BhdTransaction = NonNullable<EmailClassification['transaction']>;

/**
 * Devuelve la clasificación cuando el correo es uno de los formatos fijos BHD,
 * y `null` cuando no lo reconoce para que lo atienda el modelo.
 */
export function parseBhdFixedFormat({
  fromDomain,
  subject,
  body,
  receivedAt,
  productHints,
}: BhdFormatInput): EmailClassification | null {
  if (!isBhdEmail(fromDomain)) {
    return null;
  }
  const text = decodeHtmlEntities(`${subject}\n${body}`);
  return (
    readCardAlert({ text, receivedAt }) ??
    readOwnProductsTransfer({ text, receivedAt, productHints }) ??
    readIncomingTransfer({ text, receivedAt }) ??
    readStatementNotice({ text })
  );
}

function readCardAlert({
  text,
  receivedAt,
}: {
  text: string;
  receivedAt: Date;
}): EmailClassification | null {
  const row = readBhdCardAlertRow(text);
  if (!row) {
    return null;
  }
  const reversal = row.status === 'REVERSED';
  const purchase = row.movementType === CARD_ALERT_PURCHASE_TYPE;
  if (!reversal && !purchase) {
    return null;
  }
  return financeClassification({
    transaction: {
      kind: row.status === 'PENDING' ? 'PENDING' : 'TRANSACTION',
      amount: row.amount,
      ...readAmountContext({ text, amount: row.amount, receivedAt }),
      direction: reversal ? 'CREDIT' : 'DEBIT',
      movementClass: reversal ? 'REFUND' : 'PURCHASE',
      bankStatusNormalized: row.status,
      statusEvidence: `Estado: ${row.statusText}`,
      ...(row.merchant ? { merchant: row.merchant } : {}),
      ...readCardLast4(text),
    },
  });
}

function readOwnProductsTransfer({
  text,
  receivedAt,
  productHints,
}: {
  text: string;
  receivedAt: Date;
  productHints: EmailProductHints | null;
}): EmailClassification | null {
  if (!OWN_PRODUCTS_PATTERN.test(text) || !productHints) {
    return null;
  }
  const originLast4 = readTrailingLast4(OWN_PRODUCTS_ORIGIN_PATTERN, text);
  const destinationLast4 = readTrailingLast4(
    OWN_PRODUCTS_DESTINATION_PATTERN,
    text,
  );
  const amount = readAmount(text);
  const reference = readGroup(CONFIRMATION_PATTERN, text);
  if (!originLast4 || !destinationLast4 || amount === null || !reference) {
    return null;
  }
  return financeClassification({
    transaction: {
      kind: 'TRANSACTION',
      amount,
      ...readAmountContext({ text, amount, receivedAt }),
      bankReference: reference,
      accountNumberLast4: originLast4,
      ...readOwnProductsSide({ destinationLast4, productHints }),
    },
  });
}

/**
 * El destino decide la clase: una tarjeta es un pago de tarjeta y una cuenta es
 * una transferencia. Si no es ninguno de los productos propios, la clase queda
 * sin decidir y el motor la manda a revisión sin inventar el lado.
 */
function readOwnProductsSide({
  destinationLast4,
  productHints,
}: {
  destinationLast4: string;
  productHints: EmailProductHints;
}): Pick<BhdTransaction, 'movementClass' | 'direction' | 'last4'> {
  if (productHints.cardLast4.includes(destinationLast4)) {
    return {
      movementClass: 'CARD_PAYMENT',
      direction: 'DEBIT',
      last4: destinationLast4,
    };
  }
  if (productHints.accountLast4.includes(destinationLast4)) {
    return { movementClass: 'TRANSFER_OUT', direction: 'TRANSFER' };
  }
  return { movementClass: 'OTHER', direction: 'TRANSFER' };
}

function readIncomingTransfer({
  text,
  receivedAt,
}: {
  text: string;
  receivedAt: Date;
}): EmailClassification | null {
  if (!INCOMING_TRANSFER_PATTERN.test(text)) {
    return null;
  }
  const accountNumberLast4 = readTrailingLast4(INCOMING_PRODUCT_PATTERN, text);
  const amount = readAmount(text);
  if (!accountNumberLast4 || amount === null) {
    return null;
  }
  const sender = readGroup(INCOMING_SENDER_PATTERN, text);
  return financeClassification({
    transaction: {
      kind: 'TRANSACTION',
      amount,
      ...readAmountContext({ text, amount, receivedAt }),
      movementClass: 'TRANSFER_IN',
      direction: 'TRANSFER',
      accountNumberLast4,
      ...(sender ? { merchant: sender } : {}),
    },
  });
}

function readStatementNotice({
  text,
}: {
  text: string;
}): EmailClassification | null {
  if (!STATEMENT_NOTICE_PATTERN.test(text) || MONTO_PATTERN.test(text)) {
    return null;
  }
  return validateEmailClassification({
    relevance: true,
    semanticType: 'FIN_STATEMENT_NOTICE',
    routes: [FINANCE_ROUTE],
    confidence: BHD_FORMAT_CONFIDENCE,
  });
}

function financeClassification({
  transaction,
}: {
  transaction: BhdTransaction;
}): EmailClassification {
  return validateEmailClassification({
    relevance: true,
    semanticType: 'FIN_TRANSACTION',
    routes: [FINANCE_ROUTE],
    transaction,
    confidence: BHD_FORMAT_CONFIDENCE,
  });
}

/**
 * La fecha y la moneda salen del texto con los mismos lectores que el anclaje.
 * Si el texto no las verifico, no se guardan: el movimiento queda en revisión.
 */
function readAmountContext({
  text,
  amount,
  receivedAt,
}: {
  text: string;
  amount: number;
  receivedAt: Date;
}): Pick<BhdTransaction, 'currency' | 'transactionDate'> {
  const currency = extractBhdCurrency(text, amount);
  const transactionDate = extractBhdTransactionDate(text, receivedAt);
  return {
    ...(currency ? { currency: currency.code } : {}),
    ...(transactionDate
      ? { transactionDate: transactionDate.toISOString() }
      : {}),
  };
}

function readCardLast4(text: string): Pick<BhdTransaction, 'last4'> {
  const last4 = readGroup(CARD_LAST4_PATTERN, collapseWhitespace(text));
  return last4 ? { last4 } : {};
}

function readAmount(text: string): number | null {
  const value = readGroup(MONTO_PATTERN, text);
  if (!value) {
    return null;
  }
  const amount = Number(value.replace(/,/g, ''));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/** Los productos llegan enmascarados; los últimos 4 son los del producto. */
function readTrailingLast4(pattern: RegExp, text: string): string | null {
  const token = readGroup(pattern, text);
  const last4 = token?.match(/(\d{4})$/);
  return last4 ? last4[1] : null;
}

function readGroup(pattern: RegExp, text: string): string | null {
  return pattern.exec(text)?.[1]?.trim() ?? null;
}

function decodeHtmlEntities(text: string): string {
  return text.replace(
    /&(?:[a-zA-Z]+|#\d+);/g,
    (entity) => HTML_ENTITIES[entity] ?? entity,
  );
}
