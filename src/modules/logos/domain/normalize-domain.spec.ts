import { normalizeDomain } from './normalize-domain';

describe('normalizeDomain', () => {
  it('accepts a bare host', () => {
    expect(normalizeDomain('bhd.com.do')).toBe('bhd.com.do');
  });

  it('strips scheme, www, path, and port', () => {
    expect(normalizeDomain('https://www.Visa.com/about?x=1')).toBe('visa.com');
    expect(normalizeDomain('banreservas.com:443/path')).toBe('banreservas.com');
  });

  it('rejects values that are not a domain', () => {
    expect(normalizeDomain('')).toBeNull();
    expect(normalizeDomain('not a domain')).toBeNull();
    expect(normalizeDomain('localhost')).toBeNull();
  });
});
