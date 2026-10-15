import {
  institutionOrderKey,
  parseInstitutionOrderKey,
} from './institution-order';

describe('institution order cursor key', () => {
  it('round-trips sortOrder and name', () => {
    const key = institutionOrderKey({ sortOrder: 3, name: 'Banco Popular' });

    expect(parseInstitutionOrderKey(key)).toEqual({
      sortOrder: 3,
      name: 'Banco Popular',
    });
  });

  it('keeps a name that contains the separator text', () => {
    const key = institutionOrderKey({ sortOrder: 0, name: 'a:b|c' });

    expect(parseInstitutionOrderKey(key)?.name).toBe('a:b|c');
  });

  it('rejects a key without the separator', () => {
    expect(parseInstitutionOrderKey('no-separator')).toBeNull();
  });

  it('rejects a non-numeric sortOrder', () => {
    expect(parseInstitutionOrderKey('x\u0000Banco')).toBeNull();
  });
});
