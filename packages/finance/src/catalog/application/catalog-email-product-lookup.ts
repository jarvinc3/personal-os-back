import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { matchesProposalInstitution } from '@personal-os/contracts';
import type { EmailProductProposalDraft } from '@personal-os/contracts';
import { isCashInstitution } from '../../shared/domain/cash';
import { CatalogAccountRepository } from '../infrastructure/catalog-account.repository';
import { CatalogCardRepository } from '../infrastructure/catalog-card.repository';
import { CatalogInstitutionRepository } from '../infrastructure/catalog-institution.repository';

/** Looks up the product and the institution an email proposal points at. */
@Injectable()
export class CatalogEmailProductLookup {
  constructor(
    private readonly institutionsRepo: CatalogInstitutionRepository,
    private readonly accountsRepo: CatalogAccountRepository,
    private readonly cardsRepo: CatalogCardRepository,
  ) {}

  async findExistingEmailProduct(
    userId: string,
    draft: EmailProductProposalDraft,
  ): Promise<{ productId: string; ambiguous: boolean } | null> {
    const [institutions, products] = await Promise.all([
      this.institutionsRepo.findInstitutionsByUser(userId),
      draft.productType === 'ACCOUNT'
        ? this.accountsRepo.findEmailAccountCandidates(userId, draft.lastFour)
        : this.cardsRepo.findEmailCardCandidates(userId, draft.lastFour),
    ]);
    const institutionIds = new Set(
      institutions
        .filter((institution) =>
          matchesProposalInstitution(institution, draft.institution),
        )
        .map((institution) => institution.id),
    );
    const matches = products.filter((product) =>
      institutionIds.has(product.institutionId ?? ''),
    );
    if (!matches.length) {
      return null;
    }
    return { productId: matches[0].id, ambiguous: matches.length > 1 };
  }

  async resolveProposalInstitution(
    userId: string,
    draft: EmailProductProposalDraft,
  ): Promise<{ id: string }> {
    const matches = (
      await this.institutionsRepo.findInstitutionsByUser(userId)
    ).filter((institution) =>
      matchesProposalInstitution(institution, draft.institution),
    );
    if (matches.length > 1) {
      throw new ConflictException(
        'Hay varias instituciones compatibles; edita la propuesta para identificar una',
      );
    }
    if (
      draft.productType === 'CARD' &&
      draft.cardType === 'DEBIT' &&
      matches.length === 0
    ) {
      throw new BadRequestException(
        'Selecciona una institución existente para asociar una tarjeta DEBIT',
      );
    }
    this.assertNotCashInstitutionType(draft.institution.type);
    if (matches[0]) {
      return matches[0];
    }
    return this.institutionsRepo.createInstitution(userId, {
      name: draft.institution.name,
      type: draft.institution.type,
      domain: draft.institution.domain,
      country: draft.institution.country,
      shortName: null,
      sortOrder: 0,
      color: null,
      logoPath: null,
      customLogoPath: null,
      logoUrl: null,
      isActive: true,
      isSystem: false,
    });
  }

  private assertNotCashInstitutionType(type: string) {
    if (isCashInstitution({ type })) {
      throw new BadRequestException(
        'Efectivo ya existe como institución de sistema',
      );
    }
  }
}
