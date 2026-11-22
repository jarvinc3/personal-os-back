import {
  CARD_NETWORK_DOMAINS,
  cardNetworkDomain,
} from './card-network-domains';

describe('cardNetworkDomain', () => {
  it('maps every network with a brand file', () => {
    expect(cardNetworkDomain('VISA')).toBe('visa.com');
    expect(cardNetworkDomain('MASTERCARD')).toBe('mastercard.com');
    expect(cardNetworkDomain('AMEX')).toBe('americanexpress.com');
    expect(cardNetworkDomain('DISCOVER')).toBe('discover.com');
    expect(Object.keys(CARD_NETWORK_DOMAINS)).toHaveLength(4);
  });

  it('returns null for OTHER, unknown networks and empty values', () => {
    expect(cardNetworkDomain('OTHER')).toBeNull();
    expect(cardNetworkDomain('NARANJA')).toBeNull();
    expect(cardNetworkDomain('')).toBeNull();
    expect(cardNetworkDomain(null)).toBeNull();
    expect(cardNetworkDomain(undefined)).toBeNull();
  });

  it('does not read inherited keys as networks', () => {
    expect(cardNetworkDomain('toString')).toBeNull();
    expect(cardNetworkDomain('constructor')).toBeNull();
  });
});
