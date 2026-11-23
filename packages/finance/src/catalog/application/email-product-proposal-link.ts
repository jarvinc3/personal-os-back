import { Injectable } from '@nestjs/common';
import {
  matchesProposalInstitution,
  type EmailProductProposalInstitutionCandidate,
  type EmailProductProposalLinkableProduct,
  type EmailProductProposalProductLookup,
} from '@personal-os/contracts';
import { CatalogAccountRepository } from '../infrastructure/catalog-account.repository';
import { CatalogCardRepository } from '../infrastructure/catalog-card.repository';
import { CatalogInstitutionRepository } from '../infrastructure/catalog-institution.repository';

type ProductMatch = {
  id: string;
  lastFour: string | null;
  institutionId: string | null;
};

/** Links an email proposal with the existing products and institutions. */
@Injectable()
export class EmailProductProposalLink {
  constructor(
    private readonly accounts: CatalogAccountRepository,
    private readonly cards: CatalogCardRepository,
    private readonly institutions: CatalogInstitutionRepository,
  ) {}

  async findProductForLink(
    userId: string,
    productId: string,
  ): Promise<EmailProductProposalLinkableProduct | null> {
    const [account] = await this.accounts.findAccountsByIds(userId, [
      productId,
    ]);
    if (account) {
      return {
        productId: account.id,
        productType: 'ACCOUNT',
        lastFour: account.accountNumberLast4,
        isActive: account.isActive,
        institutionId: account.institutionId,
        institutionIsSystem: account.institutionRef?.isSystem ?? false,
      };
    }
    const [card] = await this.cards.findCardsByIds(userId, [productId]);
    if (!card) {
      return null;
    }
    return {
      productId: card.id,
      productType: 'CARD',
      lastFour: card.lastFour,
      isActive: card.isActive,
      institutionId: card.institutionId,
      institutionIsSystem: card.institution.isSystem,
    };
  }

  async listInstitutions(
    userId: string,
  ): Promise<EmailProductProposalInstitutionCandidate[]> {
    const institutions = await this.institutions.findInstitutionsByUser(userId);
    return institutions.map((institution) => ({
      id: institution.id,
      name: institution.name,
      domain: institution.domain,
    }));
  }

  async findProductMatches(
    userId: string,
    lookups: readonly EmailProductProposalProductLookup[],
  ): Promise<string[][]> {
    if (!lookups.length) {
      return [];
    }
    const institutions = await this.institutions.findInstitutionsByUser(userId);
    const lastFours = [...new Set(lookups.map((lookup) => lookup.lastFour))];
    const accounts: ProductMatch[] = lookups.some(
      (lookup) => lookup.productType === 'ACCOUNT',
    )
      ? (
          await this.accounts.findEmailAccountCandidatesByLastFours(
            userId,
            lastFours,
          )
        ).map((row) => ({
          id: row.id,
          lastFour: row.accountNumberLast4,
          institutionId: row.institutionId,
        }))
      : [];
    const cards: ProductMatch[] = lookups.some(
      (lookup) => lookup.productType === 'CARD',
    )
      ? (
          await this.cards.findEmailCardCandidatesByLastFours(userId, lastFours)
        ).map((row) => ({
          id: row.id,
          lastFour: row.lastFour,
          institutionId: row.institutionId,
        }))
      : [];
    return lookups.map((lookup) => {
      const institutionIds = new Set(
        institutions
          .filter((institution) =>
            matchesProposalInstitution(institution, lookup.institution),
          )
          .map((institution) => institution.id),
      );
      const products = lookup.productType === 'ACCOUNT' ? accounts : cards;
      return products
        .filter(
          (product) =>
            product.lastFour === lookup.lastFour &&
            product.institutionId !== null &&
            institutionIds.has(product.institutionId),
        )
        .map((product) => product.id);
    });
  }
}
