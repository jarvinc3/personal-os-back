import { Injectable } from '@nestjs/common';
import type { EmailProductProposalDraft } from '@personal-os/contracts';
import { CatalogAccountsService } from './catalog-accounts.service';
import { CatalogCardsService } from './catalog-cards.service';
import type { ProposalProduct } from './catalog-email-proposal';

export type ProposalCreation = {
  userId: string;
  draft: EmailProductProposalDraft;
  institutionId: string;
};

/** Creates the account or card approved from an email product proposal. */
@Injectable()
export class CatalogEmailProductWriter {
  constructor(
    private readonly accounts: CatalogAccountsService,
    private readonly cards: CatalogCardsService,
  ) {}

  async createAccountFromProposal(
    { userId, draft, institutionId }: ProposalCreation,
    product: Extract<ProposalProduct, { kind: 'ACCOUNT' }>,
  ): Promise<{ productId: string; duplicate: boolean }> {
    const account = await this.accounts.createAccount(userId, {
      institutionId,
      name: draft.name,
      type: product.accountType,
      currency: draft.currency ?? 'DOP',
      accountNumber: product.plaintextAccountNumber ?? undefined,
      accountNumberLast4: draft.lastFour,
    });
    return { productId: account.id, duplicate: false };
  }

  async createCardFromProposal(
    { userId, draft, institutionId }: ProposalCreation,
    product: Extract<ProposalProduct, { kind: 'CARD' }>,
  ): Promise<{ productId: string; duplicate: boolean }> {
    const card = await this.cards.createCard(userId, {
      institutionId,
      name: draft.name,
      type: product.cardType,
      lastFour: draft.lastFour,
      network: draft.network ?? undefined,
      accountId:
        product.cardType === 'DEBIT'
          ? (draft.accountId ?? undefined)
          : undefined,
    });
    return { productId: card.id, duplicate: false };
  }
}
