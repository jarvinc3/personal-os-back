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

  const direction = input.movementClass;
  if (direction !== 'TRANSFER_OUT' && direction !== 'TRANSFER_IN') {
    return [];
  }
  const side = direction === 'TRANSFER_OUT' ? 'origen' : 'destino';
  const match = new RegExp(
    `Producto\\s+${side}\\s*:\\s*[^\\r\\n]*?(\\d{4})(?!\\d)`,
    'i',
  ).exec(body);
  if (!match) {
    return [];
  }
  const lastFour = match[1];
  return [
    {
      productType: 'ACCOUNT',
      name: `Cuenta BHD ****${lastFour}`,
      lastFour,
      currency: 'DOP',
      accountType: null,
      cardType: null,
      network: null,
      institution: BHD_INSTITUTION,
      evidence: {
        label: `Producto ${side}`,
        lastFour,
        side: direction === 'TRANSFER_OUT' ? 'SOURCE' : 'DESTINATION',
      },
    },
  ];
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
