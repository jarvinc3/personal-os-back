import { SUPPORTED_JWT_ALGORITHMS } from './jwt-algorithms';

describe('SUPPORTED_JWT_ALGORITHMS', () => {
  it('accepts only the asymmetric algorithms', () => {
    expect(SUPPORTED_JWT_ALGORITHMS).toEqual(['RS256', 'ES256']);
  });
});
