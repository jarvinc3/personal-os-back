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

  const account = readOwnAccount(body, input.movementClass);
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
 * La cuenta propia es la que ya clasificó el correo. La transferencia recibida
 * escribe `Producto :`, no `Producto destino`. Un pago de tarjeta sale de
 * `Producto origen`; el destino es la tarjeta y no se propone como cuenta.
 */
function readOwnAccount(
  body: string,
  movementClass: string | null,
): { lastFour: string; label: string; side: 'SOURCE' | 'DESTINATION' } | null {
  if (movementClass === 'TRANSFER_OUT' || movementClass === 'CARD_PAYMENT') {
    const lastFour = readLabeledLast4(body, 'origen');
    return lastFour
      ? { lastFour, label: 'Producto origen', side: 'SOURCE' }
      : null;
  }
  if (movementClass !== 'TRANSFER_IN') {
    return null;
  }
  const destination = readLabeledLast4(body, 'destino');
  if (destination) {
    return {
      lastFour: destination,
      label: 'Producto destino',
      side: 'DESTINATION',
    };
  }
  const incoming = readIncomingProductLast4(body);
  return incoming
    ? { lastFour: incoming, label: 'Producto', side: 'DESTINATION' }
    : null;
}

function readLabeledLast4(body: string, label: 'origen' | 'destino') {
  return new RegExp(
    `Producto\\s+${label}\\s*:\\s*[^\\r\\n]*?(\\d{4})(?!\\d)`,
    'i',
  ).exec(body)?.[1];
}

/** Misma etiqueta que el lector de transferencias recibidas: `Producto :`. */
function readIncomingProductLast4(body: string) {
  const token = /Producto\s*:\s*(\S{4,40})/i.exec(body)?.[1];
  return token?.match(/(\d{4})$/)?.[1];
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
