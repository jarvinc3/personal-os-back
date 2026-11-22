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
import type { ProposalAccountNumberInput } from './catalog-account-numbers.service';
import { CatalogAccountNumbersService } from './catalog-account-numbers.service';
import { CatalogAccountsService } from './catalog-accounts.service';
import { CatalogCardsService } from './catalog-cards.service';

const LAST_FOUR_PATTERN = /^\d{4}$/;

type ProposalProduct =
  | {
      kind: 'ACCOUNT';
      accountType: NonNullable<EmailProductProposalDraft['accountType']>;
      plaintextAccountNumber: string | null;
    }
  | {
      kind: 'CARD';
      cardType: NonNullable<EmailProductProposalDraft['cardType']>;
    };

type ProposalCreation = {
  userId: string;
  draft: EmailProductProposalDraft;
  institutionId: string;
};

/** Approves an email product proposal as an account or a card. */
@Injectable()
export class CatalogEmailProductsService {
  constructor(
    private readonly accountsRepo: CatalogAccountRepository,
    private readonly cardsRepo: CatalogCardRepository,
    private readonly institutionsRepo: CatalogInstitutionRepository,
    private readonly numbers: CatalogAccountNumbersService,
    private readonly accounts: CatalogAccountsService,
    private readonly cards: CatalogCardsService,
  ) {}

  prepareEmailProposalAccountNumber(input: ProposalAccountNumberInput) {
    return this.numbers.prepareProposalAccountNumber(input);
  }

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

  async createEmailProductFromProposal(
    userId: string,
    draft: EmailProductProposalDraft,
  ): Promise<{ productId: string; duplicate: boolean }> {
    const existing = await this.findExistingEmailProduct(userId, draft);
    if (existing?.ambiguous) {
      throw new ConflictException(
        'Hay varios productos con estos últimos 4 dígitos; resuelve el duplicado antes de aprobar',
      );
    }
    if (existing) {
      return { productId: existing.productId, duplicate: true };
    }

    const product = this.validateProposal(draft);
    const institution = await this.resolveProposalInstitution(userId, draft);
    const creation = { userId, draft, institutionId: institution.id };
    if (product.kind === 'ACCOUNT') {
      return this.createAccountFromProposal(creation, product);
    }
    return this.createCardFromProposal(creation, product);
  }

  private validateProposal(draft: EmailProductProposalDraft): ProposalProduct {
    if (draft.productType === 'ACCOUNT') {
      return {
        kind: 'ACCOUNT',
        accountType: this.validatedAccountType(draft.accountType),
        plaintextAccountNumber: this.validatedProposalNumber(draft),
      };
    }
    return { kind: 'CARD', cardType: this.validatedCardType(draft) };
  }

  private validatedAccountType(
    accountType: EmailProductProposalDraft['accountType'],
  ): NonNullable<EmailProductProposalDraft['accountType']> {
    if (!accountType) {
      throw new BadRequestException(
        'Elige CHECKING, SAVINGS o INVESTMENT antes de aprobar la cuenta',
      );
    }
    return accountType;
  }

  private validatedCardType(
    draft: EmailProductProposalDraft,
  ): NonNullable<EmailProductProposalDraft['cardType']> {
    if (!draft.cardType) {
      throw new BadRequestException(
        'Elige CREDIT o DEBIT antes de aprobar la tarjeta',
      );
    }
    if (draft.cardType === 'DEBIT' && !draft.accountId) {
      throw new BadRequestException(
        'Asocia la cuenta antes de aprobar una tarjeta DEBIT',
      );
    }
    this.assertLastFour(draft.lastFour);
    return draft.cardType;
  }

  private validatedProposalNumber(
    draft: EmailProductProposalDraft,
  ): string | null {
    this.assertLastFour(draft.lastFour);
    if (draft.accountNumberCiphertext && !draft.accountNumberHash) {
      throw new BadRequestException('El número de cuenta cifrado no es válido');
    }
    if (!draft.accountNumberCiphertext && draft.accountNumberHash) {
      throw new BadRequestException(
        'El índice del número de cuenta no es válido',
      );
    }
    if (!draft.accountNumberCiphertext) {
      return null;
    }
    return this.numbers.decryptProposalNumber({
      ciphertext: draft.accountNumberCiphertext,
      hash: draft.accountNumberHash,
      lastFour: draft.lastFour,
    });
  }

  private async resolveProposalInstitution(
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

  private async createAccountFromProposal(
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

  private async createCardFromProposal(
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

  private assertLastFour(lastFour: string) {
    if (!LAST_FOUR_PATTERN.test(lastFour)) {
      throw new BadRequestException('lastFour debe tener 4 dígitos');
    }
  }

  private assertNotCashInstitutionType(type: string) {
    if (isCashInstitution({ type })) {
      throw new BadRequestException(
        'Efectivo ya existe como institución de sistema',
      );
    }
  }
}
