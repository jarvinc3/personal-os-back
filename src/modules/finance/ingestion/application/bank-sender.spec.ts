import {
  buildGmailFromQuery,
  extractEmailAddress,
  extractEmailDomain,
} from './bank-sender';

describe('extractEmailAddress', () => {
  it('normalizes a bare address', () => {
    expect(extractEmailAddress('  Alertas@BHD.com.do ')).toBe(
      'alertas@bhd.com.do',
    );
  });

  it('reads the address inside RFC display-name brackets', () => {
    expect(extractEmailAddress('Alertas <a@bhd.com.do>')).toBe('a@bhd.com.do');
  });

  it('returns null for junk', () => {
    expect(extractEmailAddress('')).toBeNull();
    expect(extractEmailAddress('not-an-email')).toBeNull();
  });
});

describe('extractEmailDomain', () => {
  it('uses the host from a display-name address', () => {
    expect(extractEmailDomain('Alertas <a@bhd.com.do>')).toBe('bhd.com.do');
  });
});

describe('buildGmailFromQuery', () => {
  it('prefers the full sender address', () => {
    expect(
      buildGmailFromQuery({
        bankSenderEmail: 'alertas@bhd.com.do',
        bankDomain: 'bhd.com.do',
      }),
    ).toBe('from:alertas@bhd.com.do');
  });

  it('falls back to domain when sender is missing', () => {
    expect(
      buildGmailFromQuery({
        bankSenderEmail: null,
        bankDomain: 'bhd.com.do',
      }),
    ).toBe('from:bhd.com.do');
  });
});
