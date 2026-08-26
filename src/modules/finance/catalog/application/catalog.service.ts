import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { decimalToString } from '../../shared/domain/mappers';
import { CatalogRepository } from '../infrastructure/catalog.repository';
import type { CreateAccountDto } from '../presentation/dto/create-account.dto';
import type { CreateCardDto } from '../presentation/dto/create-card.dto';
import type { CreateCategoryDto } from '../presentation/dto/create-category.dto';
import type { CreateInstitutionDto } from '../presentation/dto/create-institution.dto';
import type { UpdateAccountDto } from '../presentation/dto/update-account.dto';
import type { UpdateCardBalanceDto } from '../presentation/dto/update-card-balance.dto';
import type { UpdateCardDto } from '../presentation/dto/update-card.dto';
import type { UpdateCategoryDto } from '../presentation/dto/update-category.dto';
import type { UpdateInstitutionDto } from '../presentation/dto/update-institution.dto';

@Injectable()
export class CatalogService {
  constructor(private readonly repo: CatalogRepository) {}

  async listAccounts(userId: string) {
    const accounts = await this.repo.findAccountsByUser(userId);
    return accounts.map((a) => this.mapAccount(a));
  }

  async getAccount(userId: string, id: string) {
    const account = await this.repo.findAccountById(id, userId);
    if (!account) throw new NotFoundException('Account not found');
    return this.mapAccount(account);
  }

  async createAccount(userId: string, dto: CreateAccountDto) {
    return this.mapAccount(await this.repo.createAccount(userId, dto));
  }

  async updateAccount(userId: string, id: string, dto: UpdateAccountDto) {
    await this.getAccount(userId, id);
    const account = await this.repo.updateAccount(id, userId, dto);
    if (!account) throw new NotFoundException('Account not found');
    return this.mapAccount(account);
  }

  async listInstitutions(userId: string) {
    const items = await this.repo.listInstitutions(userId);
    return items.map((item) => this.mapInstitution(item));
  }

  async createInstitution(userId: string, dto: CreateInstitutionDto) {
    const created = await this.repo.createInstitution(userId, {
      name: dto.name,
      color: dto.color,
      logoUrl: dto.logoUrl,
      country: dto.country ?? 'DO',
    });
    return this.mapInstitution(created);
  }

  async updateInstitution(userId: string, id: string, dto: UpdateInstitutionDto) {
    const updated = await this.repo.updateInstitution(userId, id, dto);
    if (!updated) throw new NotFoundException('Institution not found');
    return this.mapInstitution(updated);
  }

  async deactivateInstitution(userId: string, id: string) {
    const updated = await this.repo.updateInstitution(userId, id, {
      isActive: false,
    });
    if (!updated) throw new NotFoundException('Institution not found');
    return { success: true };
  }

  async listCards(userId: string) {
    const cards = await this.repo.listCards(userId);
    return cards.map((c) => this.mapCard(c));
  }

  async getCard(userId: string, id: string) {
    const card = await this.repo.findCardById(userId, id);
    if (!card) throw new NotFoundException('Card not found');
    return this.mapCard(card);
  }

  async createCard(userId: string, dto: CreateCardDto) {
    if (dto.type === 'DEBIT') {
      if (!dto.accountId) {
        throw new BadRequestException('DEBIT cards require accountId');
      }
      await this.assertAccountOwnership(userId, dto.accountId);
    }
    if (dto.type === 'CREDIT' && dto.accountId) {
      throw new BadRequestException('CREDIT cards must not set accountId');
    }
    await this.assertInstitutionOwnership(userId, dto.institutionId);

    const created = await this.repo.createCard(userId, {
      institutionId: dto.institutionId,
      accountId: dto.type === 'DEBIT' ? dto.accountId : null,
      name: dto.name,
      type: dto.type,
      network: dto.network,
      lastFour: dto.lastFour,
      statementClosingDay: dto.statementClosingDay,
      paymentDueDay: dto.paymentDueDay,
      color: dto.color,
    });
    return this.mapCard(created);
  }

  async updateCard(userId: string, id: string, dto: UpdateCardDto) {
    const existing = await this.repo.findCardById(userId, id);
    if (!existing) throw new NotFoundException('Card not found');

    const nextType = dto.type ?? existing.type;
    if (nextType === 'DEBIT') {
      const nextAccountId =
        dto.accountId !== undefined ? dto.accountId : existing.accountId;
      if (!nextAccountId) {
        throw new BadRequestException('DEBIT cards require accountId');
      }
      await this.assertAccountOwnership(userId, nextAccountId);
    }
    if (nextType === 'CREDIT' && dto.accountId) {
      throw new BadRequestException('CREDIT cards must not set accountId');
    }

    const updated = await this.repo.updateCard(userId, id, {
      ...(dto.institutionId ? { institutionId: dto.institutionId } : {}),
      ...(dto.name ? { name: dto.name } : {}),
      ...(dto.type ? { type: dto.type } : {}),
      ...(dto.network !== undefined ? { network: dto.network } : {}),
      ...(dto.lastFour !== undefined ? { lastFour: dto.lastFour } : {}),
      ...(dto.statementClosingDay !== undefined
        ? { statementClosingDay: dto.statementClosingDay }
        : {}),
      ...(dto.paymentDueDay !== undefined
        ? { paymentDueDay: dto.paymentDueDay }
        : {}),
      ...(dto.color !== undefined ? { color: dto.color } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      ...(nextType === 'CREDIT'
        ? { accountId: null }
        : dto.accountId !== undefined
          ? { accountId: dto.accountId }
          : {}),
    });
    if (!updated) throw new NotFoundException('Card not found');
    return this.mapCard(updated);
  }

  async deactivateCard(userId: string, id: string) {
    const updated = await this.repo.updateCard(userId, id, { isActive: false });
    if (!updated) throw new NotFoundException('Card not found');
    return { success: true };
  }

  async updateCardBalance(
    userId: string,
    id: string,
    dto: UpdateCardBalanceDto,
  ) {
    const updated = await this.repo.upsertCardBalance(
      userId,
      id,
      dto.currency.toUpperCase(),
      dto.balance,
      dto.creditLimit,
    );
    if (!updated) throw new NotFoundException('Card not found');
    return {
      id: updated.id,
      cardId: updated.cardId,
      currency: updated.currency,
      balance: decimalToString(updated.balance),
      creditLimit: updated.creditLimit
        ? decimalToString(updated.creditLimit)
        : null,
    };
  }

  listCategories(userId: string) {
    return this.repo.listCategories(userId);
  }

  createCategory(userId: string, dto: CreateCategoryDto) {
    return this.repo.createCategory(userId, dto);
  }

  async updateCategory(userId: string, id: string, dto: UpdateCategoryDto) {
    const updated = await this.repo.updateCategory(userId, id, dto);
    if (!updated) throw new NotFoundException('Category not found');
    return updated;
  }

  async deleteCategory(userId: string, id: string) {
    const result = await this.repo.deleteCategory(userId, id);
    if (result.count === 0) throw new NotFoundException('Category not found');
    return { success: true };
  }

  private async assertInstitutionOwnership(userId: string, institutionId: string) {
    const items = await this.repo.listInstitutions(userId);
    if (!items.find((i) => i.id === institutionId)) {
      throw new BadRequestException('Institution not found');
    }
  }

  private async assertAccountOwnership(userId: string, accountId: string) {
    const account = await this.repo.findAccountById(accountId, userId);
    if (!account) throw new BadRequestException('Account not found');
    return account;
  }

  private mapAccount(
    account: NonNullable<Awaited<ReturnType<CatalogRepository['findAccountById']>>>,
  ) {
    return {
      id: account.id,
      institutionId: account.institutionId,
      institution: account.institution,
      institutionName: account.institutionRef?.name ?? account.institution ?? null,
      name: account.name,
      type: account.type,
      currency: account.currency,
      balance: decimalToString(account.balance),
      color: account.color,
      isActive: account.isActive,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    };
  }

  private mapInstitution(
    institution: Awaited<ReturnType<CatalogRepository['listInstitutions']>>[number],
  ) {
    return {
      id: institution.id,
      name: institution.name,
      color: institution.color,
      logoUrl: institution.logoUrl,
      country: institution.country,
      isActive: institution.isActive,
    };
  }

  private mapCard(
    card: NonNullable<Awaited<ReturnType<CatalogRepository['findCardById']>>>,
  ) {
    return {
      id: card.id,
      institutionId: card.institutionId,
      institutionName: card.institution.name,
      accountId: card.accountId,
      accountName: card.account?.name ?? null,
      name: card.name,
      type: card.type,
      network: card.network,
      lastFour: card.lastFour,
      statementClosingDay: card.statementClosingDay,
      paymentDueDay: card.paymentDueDay,
      color: card.color,
      isActive: card.isActive,
      balances: card.balances.map((b) => ({
        id: b.id,
        currency: b.currency,
        balance: decimalToString(b.balance),
        creditLimit: b.creditLimit ? decimalToString(b.creditLimit) : null,
      })),
    };
  }
}
