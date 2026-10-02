/** Shared Logo.dev domains for payment networks. OTHER has no brand file. */
export const CARD_NETWORK_DOMAINS = {
  VISA: 'visa.com',
  MASTERCARD: 'mastercard.com',
  AMEX: 'americanexpress.com',
  DISCOVER: 'discover.com',
} as const;

export type CardNetworkWithLogo = keyof typeof CARD_NETWORK_DOMAINS;

export function cardNetworkDomain(
  network: string | null | undefined,
): string | null {
  if (!network || network === 'OTHER') {
    return null;
  }
  if (network in CARD_NETWORK_DOMAINS) {
    return CARD_NETWORK_DOMAINS[network as CardNetworkWithLogo];
  }
  return null;
}
