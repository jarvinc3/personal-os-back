import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@personal-os/database';
import { LogoService, type LogoUploadFile } from '@personal-os/logos';
import type { LogoRow } from '@personal-os/logos';
import { normalizeDomain } from '@personal-os/logos';
import { PurgeInstrumentLedgerUseCase } from '../../ledger/application/purge-instrument-ledger.use-case';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import {
  ACCOUNT_NUMBER_MAX_DIGITS,
  ACCOUNT_NUMBER_MIN_DIGITS,
  isBankAccountType,
  normalizeAccountNumber,
} from '../../shared/domain/account-number';
import {
  decimalToNullableString,
  decimalToString,
} from '../../shared/domain/mappers';
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

const fallbackLogos = {
  ensureLogo: () => Promise.resolve(null),
  resolveUrl: (row?: LogoRow | null) => row?.logoUrl ?? null,
  networkLogoUrl: () => null,
  saveCustomLogo: () => Promise.reject(new Error('Logo upload unavailable')),
} as unknown as LogoService;

function omitAccountNumber<T extends { accountNumber?: string | null }>(
  dto: T,
): Omit<T, 'accountNumber'> {
  const { accountNumber, ...rest } = dto;
  void accountNumber;
  return rest;
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly repo: CatalogRepository,
    private readonly ownership: FinanceOwnershipService,
    private readonly purgeLedger: PurgeInstrumentLedgerUseCase,
    private readonly logos: LogoService = fallbackLogos,
  ) {}

  async listAccounts(userId: string) {
    const accounts = await this.repo.findAccountsByUser(userId);
    return accounts.map((a) => this.mapAccount(a));
  }

  async getAccount(userId: string, id: string) {
    const account = await this.repo.findAccountById(id, userId);
    if (!account) {
      throw new NotFoundException('Account not found');
    }
    return this.mapAccount(account);
  }

  async createAccount(userId: string, dto: CreateAccountDto) {
    this.assertAccountInstitutionRule(dto.type, dto.institutionId);
    const accountNumber = this.assertAccountNumberRule(
      dto.type,
      dto.accountNumber,
    );
    if (dto.type === 'CASH' && dto.isDefaultForInstitution) {
      throw new BadRequestException(
        'CASH accounts cannot be the default for an institution',
      );
    }
    if (dto.institutionId) {
      await this.ownership.assertInstitutionOwned(userId, dto.institutionId);
    }
    const rest = omitAccountNumber(dto);
    try {
      if (dto.isDefaultForInstitution && dto.institutionId) {
        await this.repo.clearDefaultAccount(userId, dto.institutionId);
      }
      return this.mapAccount(
        await this.repo.createAccount(userId, {
          ...rest,
          ...(accountNumber ? { accountNumber } : {}),
        }),
      );
    } catch (error) {
      this.rethrowAccountNumberConflict(error);
    }
  }

  async updateAccount(userId: string, id: string, dto: UpdateAccountDto) {
    const existing = await this.repo.findAccountById(id, userId);
    if (!existing) {
      throw new NotFoundException('Account not found');
    }

    const nextType = dto.type ?? existing.type;
    const nextInstitutionId =
      dto.institutionId !== undefined
        ? dto.institutionId
        : existing.institutionId;
    this.assertAccountInstitutionRule(nextType, nextInstitutionId ?? undefined);
    if (nextType === 'CASH' && dto.isDefaultForInstitution) {
      throw new BadRequestException(
        'CASH accounts cannot be the default for an institution',
      );
    }

    const nextAccountNumber = this.assertAccountNumberRule(
      nextType,
      nextType === 'CASH'
        ? dto.accountNumber
        : dto.accountNumber !== undefined
          ? dto.accountNumber
          : existing.accountNumber,
    );

    if (dto.institutionId) {
      await this.ownership.assertInstitutionOwned(userId, dto.institutionId);
    }
    if (
      dto.institutionId !== undefined &&
      dto.institutionId !== existing.institutionId
    ) {
      await this.ownership.assertAccountInstitutionChangeAllowed({
        userId,
        accountId: id,
        nextInstitutionId: dto.institutionId ?? null,
      });
    }

    const rest = omitAccountNumber(dto);
    try {
      if (dto.isDefaultForInstitution && nextInstitutionId) {
        await this.repo.clearDefaultAccount(userId, nextInstitutionId, id);
      }
      const account = await this.repo.updateAccount(id, userId, {
        ...rest,
        accountNumber: nextAccountNumber,
      });
      if (!account) {
        throw new NotFoundException('Account not found');
      }
      return this.mapAccount(account);
    } catch (error) {
      this.rethrowAccountNumberConflict(error);
    }
  }

  async deleteAccount(userId: string, id: string) {
    const existing = await this.repo.findAccountById(id, userId);
    if (!existing) {
      throw new NotFoundException('Account not found');
    }
    await this.purgeLedger.forAccount(userId, id);
    await this.repo.deleteCardsByAccountId(userId, id);
    const result = await this.repo.deleteAccount(userId, id);
    if (result.count === 0) {
      throw new NotFoundException('Account not found');
    }
    return { success: true };
  }

  async listInstitutions(userId: string) {
    const items = await this.repo.listInstitutions(userId);
    return items.map((item) => this.mapInstitution(item));
  }

  async createInstitution(userId: string, dto: CreateInstitutionDto) {
    const domain = this.normalizeInstitutionDomain(dto.domain);
    const logoPath = domain ? await this.logos.ensureLogo(domain) : null;
    try {
      const created = await this.repo.createInstitution(userId, {
        name: dto.name,
        color: dto.color,
        country: dto.country ?? 'DO',
        type: dto.type ?? 'bank',
        shortName: dto.shortName?.trim() || null,
        sortOrder: dto.sortOrder ?? 0,
        domain,
        logoPath,
      });
      return this.mapInstitution(created);
    } catch (error) {
      this.rethrowInstitutionNameConflict(error);
    }
  }

  async updateInstitution(
    userId: string,
    id: string,
    dto: UpdateInstitutionDto,
  ) {
    if (dto.isActive === false) {
      await this.ownership.assertInstitutionOwned(userId, id);
      await this.ownership.assertInstitutionCanArchive(userId, id);
    }
    const data: Prisma.FinInstitutionUpdateInput = {};
    if (dto.name !== undefined) {
      data.name = dto.name;
    }
    if (dto.color !== undefined) {
      data.color = dto.color;
    }
    if (dto.country !== undefined) {
      data.country = dto.country;
    }
    if (dto.type !== undefined) {
      data.type = dto.type;
    }
    if (dto.shortName !== undefined) {
      data.shortName = dto.shortName?.trim() || null;
    }
    if (dto.sortOrder !== undefined) {
      data.sortOrder = dto.sortOrder;
    }
    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
    }
    if (dto.domain !== undefined) {
      const domain = this.normalizeInstitutionDomain(dto.domain);
      data.domain = domain;
      data.logoPath = domain ? await this.logos.ensureLogo(domain) : null;
    }
    try {
      const updated = await this.repo.updateInstitution(userId, id, data);
      if (!updated) {
        throw new NotFoundException('Institution not found');
      }
      return this.mapInstitution(updated);
    } catch (error) {
      this.rethrowInstitutionNameConflict(error);
    }
  }

  async uploadInstitutionLogo(
    userId: string,
    id: string,
    file: LogoUploadFile | undefined,
  ) {
    if (!file) {
      throw new BadRequestException('Archivo obligatorio');
    }
    await this.ownership.assertInstitutionOwned(userId, id);
    let path: string;
    try {
      path = await this.logos.saveCustomLogo(userId, id, file);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'No se pudo guardar el logo',
      );
    }
    const updated = await this.repo.updateInstitution(userId, id, {
      customLogoPath: path,
    });
    if (!updated) {
      throw new NotFoundException('Institution not found');
    }
    return this.mapInstitution(updated);
  }

  async deactivateInstitution(userId: string, id: string) {
    await this.ownership.assertInstitutionOwned(userId, id);
    await this.ownership.assertInstitutionCanArchive(userId, id);
    const updated = await this.repo.updateInstitution(userId, id, {
      isActive: false,
    });
    if (!updated) {
      throw new NotFoundException('Institution not found');
    }
    return { success: true };
  }

  async deleteInstitution(userId: string, id: string) {
    const existing = await this.repo.findInstitution(userId, id);
    if (!existing) {
      throw new NotFoundException('Institution not found');
    }
    const accounts = await this.repo.listAccountsByInstitution(userId, id);
    for (const account of accounts) {
      await this.deleteAccount(userId, account.id);
    }
    const cards = await this.repo.listCardsByInstitution(userId, id);
    for (const card of cards) {
      await this.deleteCard(userId, card.id);
    }
    await this.repo.deleteEmailSourcesByInstitution(userId, id);
    await this.repo.deleteLoansByInstitution(userId, id);
    const result = await this.repo.deleteInstitution(userId, id);
    if (result.count === 0) {
      throw new NotFoundException('Institution not found');
    }
    return { success: true };
  }

  async listCards(userId: string) {
    const cards = await this.repo.listCards(userId);
    return cards.map((c) => this.mapCard(c));
  }

  async getCard(userId: string, id: string) {
    const card = await this.repo.findCardById(userId, id);
    if (!card) {
      throw new NotFoundException('Card not found');
    }
    return this.mapCard(card);
  }

  async createCard(userId: string, dto: CreateCardDto) {
    if (!dto.lastFour) {
      throw new BadRequestException('lastFour is required');
    }
    await this.ownership.assertInstitutionOwned(userId, dto.institutionId);
    if (dto.type === 'DEBIT') {
      if (!dto.accountId) {
        throw new BadRequestException('DEBIT cards require accountId');
      }
      await this.ownership.assertDebitAccountAlignment({
        userId,
        accountId: dto.accountId,
        institutionId: dto.institutionId,
      });
    }
    if (dto.type === 'CREDIT' && dto.accountId) {
      throw new BadRequestException('CREDIT cards must not set accountId');
    }

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
    if (!existing) {
      throw new NotFoundException('Card not found');
    }

    const nextType = dto.type ?? existing.type;
    const nextInstitutionId = dto.institutionId ?? existing.institutionId;
    if (!dto.lastFour && !existing.lastFour) {
      throw new BadRequestException('lastFour is required');
    }
    if (dto.institutionId) {
      await this.ownership.assertInstitutionOwned(userId, dto.institutionId);
    }

    const relocatingDebit =
      nextType === 'DEBIT' &&
      (dto.type !== undefined ||
        dto.accountId !== undefined ||
        dto.institutionId !== undefined);

    if (relocatingDebit) {
      const nextAccountId =
        dto.accountId !== undefined ? dto.accountId : existing.accountId;
      if (!nextAccountId) {
        throw new BadRequestException('DEBIT cards require accountId');
      }
      await this.ownership.assertDebitAccountAlignment({
        userId,
        accountId: nextAccountId,
        institutionId: nextInstitutionId,
      });
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
    if (!updated) {
      throw new NotFoundException('Card not found');
    }
    return this.mapCard(updated);
  }

  async deactivateCard(userId: string, id: string) {
    const updated = await this.repo.updateCard(userId, id, { isActive: false });
    if (!updated) {
      throw new NotFoundException('Card not found');
    }
    return { success: true };
  }

  async deleteCard(userId: string, id: string) {
    const existing = await this.repo.findCardById(userId, id);
    if (!existing) {
      throw new NotFoundException('Card not found');
    }
    await this.purgeLedger.forCard(userId, id);
    const result = await this.repo.deleteCard(userId, id);
    if (result.count === 0) {
      throw new NotFoundException('Card not found');
    }
    return { success: true };
  }

  async updateCardBalance(
    userId: string,
    id: string,
    dto: UpdateCardBalanceDto,
  ) {
    const card = await this.repo.findCardById(userId, id);
    if (!card) {
      throw new NotFoundException('Card not found');
    }
    if (card.type === 'CREDIT' && dto.creditLimit === undefined) {
      throw new BadRequestException('CREDIT cards require creditLimit');
    }
    const updated = await this.repo.upsertCardBalance(
      userId,
      id,
      dto.currency.toUpperCase(),
      dto.balance,
      dto.creditLimit,
    );
    if (!updated) {
      throw new NotFoundException('Card not found');
    }
    return {
      id: updated.id,
      cardId: updated.cardId,
      currency: updated.currency,
      balance: decimalToString(updated.balance),
      creditLimit: decimalToNullableString(updated.creditLimit),
    };
  }

  listCategories(userId: string, type?: 'EXPENSE' | 'INCOME') {
    return this.repo.listCategories(userId, type);
  }

  async createCategory(userId: string, dto: CreateCategoryDto) {
    if (dto.type === 'TRANSFER') {
      throw new BadRequestException('Category type must be EXPENSE or INCOME');
    }
    const type = dto.type ?? 'EXPENSE';
    if (dto.parentId) {
      await this.ownership.assertParentCategory(
        userId,
        dto.parentId,
        undefined,
        type,
      );
    }
    return this.repo.createCategory(userId, {
      name: dto.name,
      icon: dto.icon,
      color: dto.color,
      parentId: dto.parentId,
      type,
    });
  }

  async updateCategory(userId: string, id: string, dto: UpdateCategoryDto) {
    if (dto.type === 'TRANSFER') {
      throw new BadRequestException('Category type must be EXPENSE or INCOME');
    }
    const existing = await this.ownership.assertCategoryVisible(userId, id);
    const nextParentId =
      dto.parentId === undefined ? existing.parentId : dto.parentId;
    const nextType = dto.type ?? existing.type;
    const typeChanged = dto.type !== undefined && dto.type !== existing.type;

    if (typeChanged && nextParentId) {
      throw new BadRequestException(
        'Cannot change type while the category has a parent',
      );
    }

    if (typeof nextParentId === 'string') {
      await this.ownership.assertParentCategory(
        userId,
        nextParentId,
        id,
        nextType,
      );
    }

    const cascadeType =
      typeChanged &&
      !nextParentId &&
      (dto.type === 'EXPENSE' || dto.type === 'INCOME')
        ? dto.type
        : undefined;

    const updated = await this.repo.updateCategory(
      userId,
      id,
      {
        name: dto.name,
        icon: dto.icon,
        color: dto.color,
        parentId: dto.parentId,
        ...(cascadeType ? { type: cascadeType } : {}),
      },
      cascadeType,
    );
    if (!updated) {
      throw new NotFoundException('Category not found');
    }
    return updated;
  }

  async deleteCategory(userId: string, id: string) {
    const result = await this.repo.deleteCategory(userId, id);
    if (result.count === 0) {
      throw new NotFoundException('Category not found');
    }
    return { success: true };
  }

  private assertAccountInstitutionRule(
    type: string,
    institutionId: string | null | undefined,
  ) {
    if (type !== 'CASH' && !institutionId) {
      throw new BadRequestException(
        'CHECKING, SAVINGS, and INVESTMENT accounts require institutionId',
      );
    }
  }

  private assertAccountNumberRule(
    type: string,
    raw: string | null | undefined,
  ): string | null {
    const accountNumber = normalizeAccountNumber(raw);
    if (!isBankAccountType(type)) {
      if (accountNumber) {
        throw new BadRequestException(
          'CASH accounts must not set accountNumber',
        );
      }
      return null;
    }
    if (
      !accountNumber ||
      accountNumber.length < ACCOUNT_NUMBER_MIN_DIGITS ||
      accountNumber.length > ACCOUNT_NUMBER_MAX_DIGITS
    ) {
      throw new BadRequestException(
        'CHECKING, SAVINGS, and INVESTMENT accounts require an account number of 4 to 34 digits',
      );
    }
    return accountNumber;
  }

  private normalizeInstitutionDomain(
    domain: string | null | undefined,
  ): string | null {
    if (domain == null || domain.trim() === '') {
      return null;
    }
    const normalized = normalizeDomain(domain);
    if (!normalized) {
      throw new BadRequestException('Dominio inválido');
    }
    return normalized;
  }

  private rethrowInstitutionNameConflict(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Ya existe una institución con ese nombre');
    }
    throw error;
  }

  private rethrowAccountNumberConflict(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        'Ya existe una cuenta con ese número en esta institución',
      );
    }
    throw error;
  }

  private mapAccount(
    account: NonNullable<
      Awaited<ReturnType<CatalogRepository['findAccountById']>>
    >,
  ) {
    return {
      id: account.id,
      institutionId: account.institutionId,
      institutionName: account.institutionRef?.name ?? null,
      institutionLogoUrl: this.logos.resolveUrl(account.institutionRef),
      name: account.name,
      type: account.type,
      currency: account.currency,
      accountNumber: account.accountNumber,
      isDefaultForInstitution: account.isDefaultForInstitution,
      balance: decimalToString(account.balance),
      color: account.color,
      isActive: account.isActive,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    };
  }

  private mapInstitution(
    institution: Awaited<
      ReturnType<CatalogRepository['listInstitutions']>
    >[number],
  ) {
    return {
      id: institution.id,
      name: institution.name,
      type: institution.type ?? 'bank',
      shortName: institution.shortName ?? null,
      sortOrder: institution.sortOrder ?? 0,
      domain: institution.domain ?? null,
      color: institution.color,
      logoUrl: this.logos.resolveUrl(institution),
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
      institutionLogoUrl: this.logos.resolveUrl(card.institution),
      networkLogoUrl: this.logos.networkLogoUrl(card.network),
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
        creditLimit: decimalToNullableString(b.creditLimit),
      })),
    };
  }
}
