import { readTrailingLast4 } from './bhd-email-format';

export type EmailProductProposalEvidence = {
  label: string;
  lastFour: string;
  side: 'CARD' | 'SOURCE' | 'DESTINATION';
};

export type DetectedEmailProductProposal = {
  productType: 'ACCOUNT' | 'CARD';
  name: string;
  lastFour: string;
  currency: string;
  accountType: 'CHECKING' | 'SAVINGS' | 'INVESTMENT' | null;
  cardType: 'CREDIT' | 'DEBIT' | null;
  network: 'VISA' | 'MASTERCARD' | 'AMEX' | 'DISCOVER' | 'OTHER' | null;
  institution: {
    name: string;
    type: 'bank';
    domain: string;
    country: 'DO';
  };
  evidence: EmailProductProposalEvidence;
};

const BHD_INSTITUTION = {
  name: 'BHD',
  type: 'bank' as const,
  domain: 'bhd.com.do',
  country: 'DO' as const,
};

/** Parses only explicit BHD product labels and the classified own transfer side. */
export function detectBhdEmailProductProposal(input: {
  fromDomain: string;
  subject: string;
  body: string;
  movementClass: string | null;
  /** La cuenta que ya resolvió el clasificador; confirma qué etiqueta es del dueño. */
  accountNumberLast4: string | null;
}): DetectedEmailProductProposal[] {
  if (input.fromDomain.trim().toLowerCase() !== BHD_INSTITUTION.domain) {
    return [];
  }

  const body = input.body;
  const cardHeader =
    /BHD\s+Notificaci[oó]n\s+de\s+Transacciones/i.test(input.subject) ||
    /BHD\s+Notificaci[oó]n\s+de\s+Transacciones/i.test(body);
  if (
    cardHeader &&
    /Detalle\s+de\s+Transacciones/i.test(body) &&
    (input.movementClass === 'PURCHASE' || input.movementClass === 'REFUND')
  ) {
    const match =
      /Tarjeta\s+([^#\r\n]{1,80}?)\s*#\s*(\d{4})/i.exec(body) ??
      /BHD\s+Notificaci[oó]n\s+de\s+Transacciones\s+([^#\r\n]{1,80}?)\s*#\s*(\d{4})/i.exec(
        body,
      );
    if (match) {
      const label = match[1].trim().replace(/\s+/g, ' ');
      const network = cardNetwork(label);
      return [
        {
          productType: 'CARD',
          name: label || 'Tarjeta BHD',
          lastFour: match[2],
          currency: body.includes('US$') ? 'USD' : 'DOP',
          accountType: null,
          cardType: null,
          network,
          institution: BHD_INSTITUTION,
          evidence: { label: 'Tarjeta', lastFour: match[2], side: 'CARD' },
        },
      ];
    }
  }

  const account = readOwnAccount({
    body,
    movementClass: input.movementClass,
    accountNumberLast4: input.accountNumberLast4,
  });
  if (!account) {
    return [];
  }
  return [
    {
      productType: 'ACCOUNT',
      name: `Cuenta BHD ****${account.lastFour}`,
      lastFour: account.lastFour,
      currency: 'DOP',
      accountType: null,
      cardType: null,
      network: null,
      institution: BHD_INSTITUTION,
      evidence: {
        label: account.label,
        lastFour: account.lastFour,
        side: account.side,
      },
    },
  ];
}

/**
 * El número del producto son los cuatro dígitos finales del token, no los
 * primeros: un IBAN enmascarado empieza por `0000`.
 */
const OWN_ORIGIN_TOKEN = /producto\s+origen\s*:\s*(\S{4,40})/i;
const OWN_DESTINATION_TOKEN = /producto\s+destino\s*:\s*(\S{4,40})/i;
/** Misma etiqueta que el lector de transferencias recibidas: `Producto :`. */
const INCOMING_PRODUCT_TOKEN = /producto\s*:\s*(\S{4,40})/i;

type OwnAccountCandidate = {
  lastFour: string;
  label: 'Producto origen' | 'Producto destino' | 'Producto';
  side: 'SOURCE' | 'DESTINATION';
};

/**
 * La cuenta propia es la que ya clasificó el correo. La transferencia recibida
 * escribe `Producto :`, no `Producto destino`. Un pago de tarjeta sale de
 * `Producto origen`; el destino es la tarjeta y no se propone como cuenta.
 */
function readOwnAccount({
  body,
  movementClass,
  accountNumberLast4,
}: {
  body: string;
  movementClass: string | null;
  accountNumberLast4: string | null;
}): OwnAccountCandidate | null {
  const candidate = readOwnAccountCandidate(body, movementClass);
  if (!candidate) {
    return null;
  }
  // La señal ya resolvió qué producto es del dueño: un token con otro número no
  // es esa cuenta y no se propone.
  if (accountNumberLast4 && candidate.lastFour !== accountNumberLast4) {
    return null;
  }
  return candidate;
}

function readOwnAccountCandidate(
  body: string,
  movementClass: string | null,
): OwnAccountCandidate | null {
  if (movementClass === 'TRANSFER_OUT' || movementClass === 'CARD_PAYMENT') {
    const lastFour = readTrailingLast4(OWN_ORIGIN_TOKEN, body);
    return lastFour
      ? { lastFour, label: 'Producto origen', side: 'SOURCE' }
      : null;
  }
  if (movementClass !== 'TRANSFER_IN') {
    return null;
  }
  const destination = readTrailingLast4(OWN_DESTINATION_TOKEN, body);
  if (destination) {
    return {
      lastFour: destination,
      label: 'Producto destino',
      side: 'DESTINATION',
    };
  }
  const incoming = readTrailingLast4(INCOMING_PRODUCT_TOKEN, body);
  return incoming
    ? { lastFour: incoming, label: 'Producto', side: 'DESTINATION' }
    : null;
}

function cardNetwork(label: string): DetectedEmailProductProposal['network'] {
  const normalized = label.toUpperCase();
  if (normalized.includes('VISA')) {
    return 'VISA';
  }
  if (normalized.includes('MASTERCARD')) {
    return 'MASTERCARD';
  }
  if (normalized.includes('AMEX')) {
    return 'AMEX';
  }
  if (normalized.includes('DISCOVER')) {
    return 'DISCOVER';
  }
  return null;
}
