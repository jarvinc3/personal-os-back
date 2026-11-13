import { Injectable } from '@nestjs/common';
import type {
  EmailProductProposalCatalogPort,
  EmailProductProposalDraft,
} from '@personal-os/contracts';
import { CatalogService } from './catalog.service';

/** Finance-owned adapter for the email proposal workflow. */
@Injectable()
export class FinanceEmailProductProposalCatalog implements EmailProductProposalCatalogPort {
  constructor(private readonly catalog: CatalogService) {}

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
}
