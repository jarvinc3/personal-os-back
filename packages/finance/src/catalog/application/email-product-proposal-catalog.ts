import { Injectable } from '@nestjs/common';
import type {
  EmailProductProposalCatalogPort,
  EmailProductProposalDraft,
  EmailProductProposalInstitutionCandidate,
  EmailProductProposalLinkableProduct,
  EmailProductProposalProductLookup,
} from '@personal-os/contracts';
import { CatalogService } from './catalog.service';
import { EmailProductProposalLink } from './email-product-proposal-link';

/** Finance-owned adapter for the email proposal workflow. */
@Injectable()
export class FinanceEmailProductProposalCatalog implements EmailProductProposalCatalogPort {
  constructor(
    private readonly catalog: CatalogService,
    private readonly link: EmailProductProposalLink,
  ) {}

  prepareAccountNumber(input: {
    accountNumber?: string | null;
    lastFour?: string;
  }) {
    return Promise.resolve(
      this.catalog.prepareEmailProposalAccountNumber(input),
    );
  }

  findExisting(userId: string, draft: EmailProductProposalDraft) {
    return this.catalog.findExistingEmailProduct(userId, draft);
  }

  createOrReuse(userId: string, draft: EmailProductProposalDraft) {
    return this.catalog.createEmailProductFromProposal(userId, draft);
  }

  findProductForLink(
    userId: string,
    productId: string,
  ): Promise<EmailProductProposalLinkableProduct | null> {
    return this.link.findProductForLink(userId, productId);
  }

  listInstitutions(
    userId: string,
  ): Promise<EmailProductProposalInstitutionCandidate[]> {
    return this.link.listInstitutions(userId);
  }

  findProductMatches(
    userId: string,
    lookups: readonly EmailProductProposalProductLookup[],
  ): Promise<string[][]> {
    return this.link.findProductMatches(userId, lookups);
  }
}
