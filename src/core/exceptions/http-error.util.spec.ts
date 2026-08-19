import { toErrorField } from './http-error.util';

describe('toErrorField', () => {
  it('returns the same string', () => {
    expect(toErrorField('Conflict', 'fallback')).toBe('Conflict');
  });

  it('stringifies a number', () => {
    expect(toErrorField(404, 'fallback')).toBe('404');
  });

  it('stringifies a boolean', () => {
    expect(toErrorField(false, 'fallback')).toBe('false');
  });

  it('uses Error.message', () => {
    expect(toErrorField(new Error('boom'), 'fallback')).toBe('boom');
  });

  it('returns fallback for null and plain objects', () => {
    expect(toErrorField(null, 'fallback')).toBe('fallback');
    expect(toErrorField({}, 'fallback')).toBe('fallback');
    expect(toErrorField(undefined, 'fallback')).toBe('fallback');
  });
});
