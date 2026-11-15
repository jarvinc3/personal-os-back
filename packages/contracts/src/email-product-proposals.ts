/**
 * Regla única para reconocer una institución existente a partir de la que trae
 * un correo: mismo dominio, o nombre normalizado. La usan Finanzas al crear un
 * producto desde el borrador y el listado de propuestas al indicar coincidencias.
 */
export type ProposalInstitutionCandidate = {
  name: string;
  domain: string | null;
};

function normalizeInstitutionName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function matchesProposalInstitution(
  candidate: ProposalInstitutionCandidate,
  institution: ProposalInstitutionCandidate,
): boolean {
  const domain = institution.domain?.trim().toLowerCase();
  if (domain && candidate.domain?.trim().toLowerCase() === domain) {
    return true;
  }
  return (
    normalizeInstitutionName(candidate.name) ===
    normalizeInstitutionName(institution.name)
  );
}
