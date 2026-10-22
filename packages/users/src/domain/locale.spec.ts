import { isLocaleTag } from './locale';

describe('isLocaleTag', () => {
  it('accepts language and language-region tags', () => {
    expect(isLocaleTag('es')).toBe(true);
    expect(isLocaleTag('es-DO')).toBe(true);
    expect(isLocaleTag('en-US')).toBe(true);
    expect(isLocaleTag('zh-Hant-TW')).toBe(true);
  });

  it('rejects malformed tags and non strings', () => {
    expect(isLocaleTag('es_DO')).toBe(false);
    expect(isLocaleTag('not a locale')).toBe(false);
    expect(isLocaleTag('')).toBe(false);
    expect(isLocaleTag(null)).toBe(false);
    expect(isLocaleTag(42)).toBe(false);
  });
});
