import { describe, expect, it } from '@jest/globals';
import {
  matchesProposalInstitution,
  type ProposalInstitutionCandidate,
} from './email-product-proposals';

function institution(
  overrides: Partial<ProposalInstitutionCandidate> = {},
): ProposalInstitutionCandidate {
  return { name: 'BHD', domain: 'bhd.com.do', ...overrides };
}

describe('matchesProposalInstitution', () => {
  it('matches the same domain regardless of case and spaces', () => {
    expect(
      matchesProposalInstitution(
        institution({ name: 'Otro nombre', domain: ' BHD.com.DO ' }),
        institution(),
      ),
    ).toBe(true);
  });

  it('matches a normalized name with accents and punctuation', () => {
    expect(
      matchesProposalInstitution(
        institution({ name: 'Banco BHD, S.A.', domain: null }),
        institution({ name: 'banco bhd sa', domain: null }),
      ),
    ).toBe(true);
  });

  it('does not match different institutions', () => {
    expect(
      matchesProposalInstitution(
        institution({ name: 'Banreservas', domain: 'banreservas.com' }),
        institution(),
      ),
    ).toBe(false);
  });

  it('falls back to the name when the domain is empty', () => {
    expect(
      matchesProposalInstitution(
        institution({ domain: '' }),
        institution({ name: 'BHD', domain: null }),
      ),
    ).toBe(true);
  });
});
