import { ConflictException, Injectable } from '@nestjs/common';
import type { EmailProductProposalDraft } from '@personal-os/contracts';
import type { ProposalAccountNumberInput } from './catalog-account-numbers.service';
import { CatalogEmailProductLookup } from './catalog-email-product-lookup';
import { CatalogEmailProductWriter } from './catalog-email-product-writer';
import { CatalogEmailProposal } from './catalog-email-proposal';

/** Approves an email product proposal as an account or a card. */
@Injectable()
export class CatalogEmailProductsService {
  constructor(
    private readonly proposal: CatalogEmailProposal,
    private readonly lookup: CatalogEmailProductLookup,
    private readonly writer: CatalogEmailProductWriter,
  ) {}

  prepareEmailProposalAccountNumber(input: ProposalAccountNumberInput) {
    return this.proposal.prepareAccountNumber(input);
  }

  findExistingEmailProduct(
    userId: string,
    draft: EmailProductProposalDraft,
  ): Promise<{ productId: string; ambiguous: boolean } | null> {
    return this.lookup.findExistingEmailProduct(userId, draft);
  }

  async createEmailProductFromProposal(
    userId: string,
    draft: EmailProductProposalDraft,
  ): Promise<{ productId: string; duplicate: boolean }> {
    const existing = await this.lookup.findExistingEmailProduct(userId, draft);
    if (existing?.ambiguous) {
      throw new ConflictException(
        'Hay varios productos con estos últimos 4 dígitos; resuelve el duplicado antes de aprobar',
      );
    }
    if (existing) {
      return { productId: existing.productId, duplicate: true };
    }

    const product = this.proposal.product(draft);
    const institution = await this.lookup.resolveProposalInstitution(
      userId,
      draft,
    );
    const creation = { userId, draft, institutionId: institution.id };
    if (product.kind === 'ACCOUNT') {
      return this.writer.createAccountFromProposal(creation, product);
    }
    return this.writer.createCardFromProposal(creation, product);
  }
}
