import { merchantDisplayName, normalizeMerchant } from './normalize-merchant';

describe('normalizeMerchant', () => {
  it('groups the UBER card descriptor with the app name', () => {
    expect(normalizeMerchant('UBER *TRIP 1234')).toBe('UBER');
    expect(normalizeMerchant('Uber Eats')).toBe('UBER');
    expect(normalizeMerchant('UBER TRIP SANTO DOMINGO')).toBe('UBER');
  });

  it('drops the reference tail after the star', () => {
    expect(normalizeMerchant('AMZN Mktp US*2A3B4')).toBe('AMZN MKTP US');
  });

  it('drops the payment gateway prefix', () => {
    expect(normalizeMerchant('PAYPAL *NETFLIX')).toBe('NETFLIX');
    expect(normalizeMerchant('SQ *CAFE CIBAO')).toBe('CAFE CIBAO');
  });

  it('keeps the spanish merchant text from the BHD card email', () => {
    expect(normalizeMerchant('SM NACIONAL LOPE DE VE')).toBe(
      'SM NACIONAL LOPE DE VE',
    );
  });

  it('keeps the provider from the BHD service payment email', () => {
    expect(normalizeMerchant('ALTICE MOVIL')).toBe('ALTICE MOVIL');
  });

  it('keeps the beneficiary from the Popular instant transfer email', () => {
    expect(normalizeMerchant('LUIS MIGUEL SANTOS FERNANDE')).toBe(
      'LUIS MIGUEL SANTOS FERNANDE',
    );
  });

  it('keeps the sender from the Qik token email', () => {
    expect(normalizeMerchant('Jarvin A Perez Gomez')).toBe(
      'JARVIN A PEREZ GOMEZ',
    );
  });

  it('drops reference digits without a star', () => {
    expect(normalizeMerchant('NETFLIX.COM 8001234567')).toBe('NETFLIX.COM');
  });

  it('returns null when nothing usable remains', () => {
    expect(normalizeMerchant('   *1234 ')).toBeNull();
    expect(normalizeMerchant(null)).toBeNull();
    expect(normalizeMerchant('1234')).toBeNull();
  });
});

describe('merchantDisplayName', () => {
  it('title-cases the canonical key', () => {
    expect(merchantDisplayName('UBER *TRIP 1234')).toBe('Uber');
    expect(merchantDisplayName('SM NACIONAL LOPE DE VE')).toBe(
      'Sm Nacional Lope De Ve',
    );
  });

  it('returns null when there is no key', () => {
    expect(merchantDisplayName('1234')).toBeNull();
  });
});

describe('normalizeMerchant accents, plurals and domains', () => {
  it('folds accents without cutting the word', () => {
    expect(normalizeMerchant('Café Lindo')).toBe('CAFE LINDO');
    expect(normalizeMerchant('Cafe Lindo')).toBe('CAFE LINDO');
    expect(normalizeMerchant('Pan Ñandú')).toBe('PAN NANDU');
  });

  it('treats the head word plural as the same merchant', () => {
    expect(normalizeMerchant('Cinema Centro')).toBe(
      normalizeMerchant('Cinemas Centro'),
    );
    expect(normalizeMerchant('Supermercado Nacional')).toBe(
      normalizeMerchant('Supermercados Nacional'),
    );
  });

  it('ignores the web suffix', () => {
    expect(normalizeMerchant('Netflix.com')).toBe('NETFLIX');
    expect(normalizeMerchant('Netflix')).toBe('NETFLIX');
    expect(normalizeMerchant('Claro.com.do')).toBe('CLARO');
  });

  it('keeps a trailing number, which is a different merchant', () => {
    expect(normalizeMerchant('Supermercado Nacional 5')).toBe(
      'SUPERMERCADO NACIONAL 5',
    );
    expect(normalizeMerchant('Supermercado Nacional')).not.toBe(
      normalizeMerchant('Supermercado Nacional 5'),
    );
  });

  it('keeps surnames that end in S', () => {
    expect(normalizeMerchant('LUIS MIGUEL SANTOS FERNANDE')).toBe(
      'LUIS MIGUEL SANTOS FERNANDE',
    );
  });
});
