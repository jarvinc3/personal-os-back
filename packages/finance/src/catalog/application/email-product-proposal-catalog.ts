import { Injectable } from '@nestjs/common';
import {
  matchesProposalInstitution,
  type EmailProductProposalCatalogPort,
  type EmailProductProposalDraft,
  type EmailProductProposalInstitutionCandidate,
  type EmailProductProposalLinkableProduct,
  type EmailProductProposalProductLookup,
} from '@personal-os/contracts';
import { CatalogService } from './catalog.service';
import { CatalogRepository } from '../infrastructure/catalog.repository';

type ProductMatch = {
  id: string;
  lastFour: string | null;
  institutionId: string | null;
};

/** Finance-owned adapter for the email proposal workflow. */
@Injectable()
export class FinanceEmailProductProposalCatalog implements EmailProductProposalCatalogPort {
  constructor(
    private readonly catalog: CatalogService,
    private readonly repo: CatalogRepository,
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

  async findProductForLink(
    userId: string,
    productId: string,
  ): Promise<EmailProductProposalLinkableProduct | null> {
    const [account] = await this.repo.findAccountsByIds(userId, [productId]);
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
    const [card] = await this.repo.findCardsByIds(userId, [productId]);
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
    const institutions = await this.repo.findInstitutionsByUser(userId);
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
    const institutions = await this.repo.findInstitutionsByUser(userId);
    const lastFours = [...new Set(lookups.map((lookup) => lookup.lastFour))];
    const accounts = lookups.some((lookup) => lookup.productType === 'ACCOUNT')
      ? await this.accountsByLastFour(userId, lastFours)
      : [];
    const cards = lookups.some((lookup) => lookup.productType === 'CARD')
      ? await this.cardsByLastFour(userId, lastFours)
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

  /** Candidatos activos por últimos 4; un producto archivado no cuenta. */
  private async accountsByLastFour(
    userId: string,
    lastFours: readonly string[],
  ): Promise<ProductMatch[]> {
    const rows = await Promise.all(
      lastFours.map((lastFour) =>
        this.repo.findEmailAccountCandidates(userId, lastFour),
      ),
    );
    return rows.flat().map((row) => ({
      id: row.id,
      lastFour: row.accountNumberLast4,
      institutionId: row.institutionId,
    }));
  }

  private async cardsByLastFour(
    userId: string,
    lastFours: readonly string[],
  ): Promise<ProductMatch[]> {
    const rows = await Promise.all(
      lastFours.map((lastFour) =>
        this.repo.findEmailCardCandidates(userId, lastFour),
      ),
    );
    return rows.flat().map((row) => ({
      id: row.id,
      lastFour: row.lastFour,
      institutionId: row.institutionId,
    }));
  }
}
