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

export type EmailProductProposalDraft = {
  productType: 'ACCOUNT' | 'CARD';
  name: string;
  lastFour: string;
  currency: string | null;
  accountType: 'CHECKING' | 'SAVINGS' | 'INVESTMENT' | null;
  cardType: 'CREDIT' | 'DEBIT' | null;
  network: 'VISA' | 'MASTERCARD' | 'AMEX' | 'DISCOVER' | 'OTHER' | null;
  accountId: string | null;
  institution: {
    name: string;
    type: string;
    domain: string | null;
    country: string;
  };
  /** AES-GCM ciphertext; never returned by the proposal API. */
  accountNumberCiphertext: string | null;
  /** HMAC blind index; never returned by the proposal API. */
  accountNumberHash: string | null;
};

export type EmailProductProposalAccountNumber = {
  ciphertext: string | null;
  hash: string | null;
  lastFour: string;
};

/** Producto del catálogo que se puede vincular a una propuesta aprobada. */
export type EmailProductProposalLinkableProduct = {
  productId: string;
  productType: 'ACCOUNT' | 'CARD';
  lastFour: string | null;
  isActive: boolean;
  institutionId: string | null;
  institutionIsSystem: boolean;
};

/** Institución del usuario que el listado compara con el borrador. */
export type EmailProductProposalInstitutionCandidate = {
  id: string;
  name: string;
  domain: string | null;
};

/** Borrador que se cruza contra el catálogo para ofrecer «Vincular existente». */
export type EmailProductProposalProductLookup = {
  productType: 'ACCOUNT' | 'CARD';
  lastFour: string;
  institution: { name: string; domain: string | null };
};

export interface EmailProductProposalCatalogPort {
  prepareAccountNumber(input: {
    accountNumber?: string | null;
    lastFour?: string;
  }): Promise<EmailProductProposalAccountNumber>;
  findExisting(
    userId: string,
    draft: EmailProductProposalDraft,
  ): Promise<{ productId: string; ambiguous: boolean } | null>;
  createOrReuse(
    userId: string,
    draft: EmailProductProposalDraft,
  ): Promise<{ productId: string; duplicate: boolean }>;
  /** Producto creado con los endpoints nativos; null si no es del usuario. */
  findProductForLink(
    userId: string,
    productId: string,
  ): Promise<EmailProductProposalLinkableProduct | null>;
  /** Instituciones del usuario para indicar coincidencias en el listado. */
  listInstitutions(
    userId: string,
  ): Promise<EmailProductProposalInstitutionCandidate[]>;
  /**
   * Productos activos compatibles con cada borrador, en el mismo orden. La
   * institución se compara con la regla compartida y un producto archivado no
   * cuenta como existente.
   */
  findProductMatches(
    userId: string,
    lookups: readonly EmailProductProposalProductLookup[],
  ): Promise<string[][]>;
}
