import { Injectable } from '@nestjs/common';
import type { EmailProductProposalDraft } from '@personal-os/contracts';
import type { CursorQueryDto } from '@personal-os/core';
import type { LogoUploadFile } from '@personal-os/logos';
import type { ProposalAccountNumberInput } from './catalog-account-numbers.service';
import { CatalogAccountsService } from './catalog-accounts.service';
import { CatalogCardBalancesService } from './catalog-card-balances.service';
import { CatalogCardsService } from './catalog-cards.service';
import { CatalogCategoriesService } from './catalog-categories.service';
import { CatalogEmailProductsService } from './catalog-email-products.service';
import { CatalogInstitutionsService } from './catalog-institutions.service';
import type { CreateAccountDto } from '../presentation/dto/create-account.dto';
import type { CreateCardDto } from '../presentation/dto/create-card.dto';
import type { CreateCategoryDto } from '../presentation/dto/create-category.dto';
import type { CreateInstitutionDto } from '../presentation/dto/create-institution.dto';
import type { UpdateAccountDto } from '../presentation/dto/update-account.dto';
import type { UpdateCardBalanceDto } from '../presentation/dto/update-card-balance.dto';
import type { UpdateCardDto } from '../presentation/dto/update-card.dto';
import type { UpdateCategoryDto } from '../presentation/dto/update-category.dto';
import type { UpdateInstitutionDto } from '../presentation/dto/update-institution.dto';

/**
 * Public surface of the catalog module. Each method belongs to one service:
 * accounts, institutions, cards, card balances, email products and categories.
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly accounts: CatalogAccountsService,
    private readonly institutions: CatalogInstitutionsService,
    private readonly cards: CatalogCardsService,
    private readonly cardBalances: CatalogCardBalancesService,
    private readonly emailProducts: CatalogEmailProductsService,
    private readonly categories: CatalogCategoriesService,
  ) {}

  prepareEmailProposalAccountNumber(input: ProposalAccountNumberInput) {
    return this.emailProducts.prepareEmailProposalAccountNumber(input);
  }

  findExistingEmailProduct(userId: string, draft: EmailProductProposalDraft) {
    return this.emailProducts.findExistingEmailProduct(userId, draft);
  }

  createEmailProductFromProposal(
    userId: string,
    draft: EmailProductProposalDraft,
  ) {
    return this.emailProducts.createEmailProductFromProposal(userId, draft);
  }

  listAccounts(userId: string) {
    return this.accounts.listAccounts(userId);
  }

  listAccountsPage(userId: string, query: CursorQueryDto) {
    return this.accounts.listAccountsPage(userId, query);
  }

  getAccount(userId: string, id: string) {
    return this.accounts.getAccount(userId, id);
  }

  lookupAccounts(userId: string, ids: readonly string[]) {
    return this.accounts.lookupAccounts(userId, ids);
  }

  lookupInstitutions(userId: string, ids: readonly string[]) {
    return this.institutions.lookupInstitutions(userId, ids);
  }

  createAccount(userId: string, dto: CreateAccountDto) {
    return this.accounts.createAccount(userId, dto);
  }

  updateAccount(userId: string, id: string, dto: UpdateAccountDto) {
    return this.accounts.updateAccount(userId, id, dto);
  }

  deleteAccount(userId: string, id: string) {
    return this.accounts.deleteAccount(userId, id);
  }

  restoreAccount(userId: string, id: string, now: Date) {
    return this.accounts.restoreAccount(userId, id, now);
  }

  listInstitutionsPage(userId: string, query: CursorQueryDto) {
    return this.institutions.listInstitutionsPage(userId, query);
  }

  createInstitution(userId: string, dto: CreateInstitutionDto) {
    return this.institutions.createInstitution(userId, dto);
  }

  updateInstitution(userId: string, id: string, dto: UpdateInstitutionDto) {
    return this.institutions.updateInstitution(userId, id, dto);
  }

  uploadInstitutionLogo(
    userId: string,
    id: string,
    file: LogoUploadFile | undefined,
  ) {
    return this.institutions.uploadInstitutionLogo(userId, id, file);
  }

  deactivateInstitution(userId: string, id: string) {
    return this.institutions.deactivateInstitution(userId, id);
  }

  deleteInstitution(userId: string, id: string) {
    return this.institutions.deleteInstitution(userId, id);
  }

  restoreInstitution(userId: string, id: string, now: Date) {
    return this.institutions.restoreInstitution(userId, id, now);
  }

  listCardsPage(userId: string, query: CursorQueryDto) {
    return this.cards.listCardsPage(userId, query);
  }

  listCards(userId: string) {
    return this.cards.listCards(userId);
  }

  getCard(userId: string, id: string) {
    return this.cards.getCard(userId, id);
  }

  lookupCards(userId: string, ids: readonly string[]) {
    return this.cards.lookupCards(userId, ids);
  }

  createCard(userId: string, dto: CreateCardDto) {
    return this.cards.createCard(userId, dto);
  }

  updateCard(userId: string, id: string, dto: UpdateCardDto) {
    return this.cards.updateCard(userId, id, dto);
  }

  deactivateCard(userId: string, id: string) {
    return this.cards.deactivateCard(userId, id);
  }

  deleteCard(userId: string, id: string) {
    return this.cards.deleteCard(userId, id);
  }

  restoreCard(userId: string, id: string, now: Date) {
    return this.cards.restoreCard(userId, id, now);
  }

  updateCardBalance(userId: string, id: string, dto: UpdateCardBalanceDto) {
    return this.cardBalances.updateCardBalance(userId, id, dto);
  }

  updateCardCreditLimit(
    userId: string,
    id: string,
    dto: { currency: string; creditLimit: number },
  ) {
    return this.cardBalances.updateCardCreditLimit(userId, id, dto);
  }

  deleteCardBalance(userId: string, id: string, currency: string) {
    return this.cardBalances.deleteCardBalance(userId, id, currency);
  }

  listCategories(userId: string, type?: 'EXPENSE' | 'INCOME') {
    return this.categories.listCategories(userId, type);
  }

  createCategory(userId: string, dto: CreateCategoryDto) {
    return this.categories.createCategory(userId, dto);
  }

  updateCategory(userId: string, id: string, dto: UpdateCategoryDto) {
    return this.categories.updateCategory(userId, id, dto);
  }

  deleteCategory(userId: string, id: string) {
    return this.categories.deleteCategory(userId, id);
  }

  restoreCategory(userId: string, id: string, now: Date) {
    return this.categories.restoreCategory(userId, id, now);
  }
}
