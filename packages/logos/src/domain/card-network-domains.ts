/** Shared Logo.dev domains for payment networks. OTHER has no brand file. */
export const CARD_NETWORK_DOMAINS = {
  VISA: 'visa.com',
  MASTERCARD: 'mastercard.com',
  AMEX: 'americanexpress.com',
  DISCOVER: 'discover.com',
} as const;

export type CardNetworkWithLogo = keyof typeof CARD_NETWORK_DOMAINS;

function isCardNetworkWithLogo(value: string): value is CardNetworkWithLogo {
  return Object.hasOwn(CARD_NETWORK_DOMAINS, value);
}

export function cardNetworkDomain(
  network: string | null | undefined,
): string | null {
  if (!network || !isCardNetworkWithLogo(network)) {
    return null;
  }
  return CARD_NETWORK_DOMAINS[network];
}
