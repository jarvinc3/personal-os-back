import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@personal-os/database';
import { clampPageLimit, toCursorPage } from '@personal-os/core';
import type { CursorQueryDto } from '@personal-os/core';
import type { Env } from '@personal-os/config';
import { LogoService, type LogoUploadFile } from '@personal-os/logos';
import type { LogoRow } from '@personal-os/logos';
import { normalizeDomain } from '@personal-os/logos';
import { UsersService } from '@personal-os/users';
import { availableCredit } from '../../statements/domain/card-statement-amounts';
import { buildNextCardCycle } from '../../statements/domain/card-statement-cycle';
import { isoDay, localDayStart } from '../../shared/domain/local-day';
import { PurgeInstrumentLedgerUseCase } from '../../ledger/application/purge-instrument-ledger.use-case';
import type { LedgerTransactionRow } from '../../ledger/application/ports/ledger.repository.port';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { assertRestored } from '../../shared/application/assert-restored';
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
import { normalizeCurrencyCode, roundMoney } from '../../shared/domain/money';
import { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import {
  accountNumberLast4,
  encryptAccountNumber,
  fingerprintAccountNumber,
} from '../../shared/infrastructure/account-number-encryption.util';
import { CASH_ACCOUNT_TYPE, isCashInstitution } from '../../shared/domain/cash';
import {
  ACCOUNT_HAS_GOAL_MONEY,
  ACCOUNT_HAS_GOAL_MONEY_MESSAGE,
} from '../../shared/domain/savings-goal';
import { EnsureCashInstitutionUseCase } from './ensure-cash-institution.use-case';
import { CatalogCategoriesService } from './catalog-categories.service';
import { institutionOrderKey } from '../domain/institution-order';
import { CatalogRepository } from '../infrastructure/catalog.repository';
import type { AccountNumberColumns } from '../infrastructure/catalog.repository';
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

const fallbackUsers = {
  findById: () => Promise.resolve({ timezone: null }),
} as unknown as UsersService;

type CardRow = NonNullable<
  Awaited<ReturnType<CatalogRepository['findCardById']>>
>;

function mapCardBalance(
  balance: CardRow['balances'][number],
  transactions: CardRow['transactions'],
) {
  return {
    id: balance.id,
    currency: balance.currency,
    balance: decimalToString(balance.balance),
    creditLimit: decimalToNullableString(balance.creditLimit),
    availableCredit:
      balance.creditLimit === null
        ? null
        : decimalToString(
            availableCredit({
              storedAvailable: Number(balance.balance),
              movements: transactions.filter(
                (movement) => movement.ledgerCurrency === balance.currency,
              ),
            }),
          ),
  };
}

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
    private readonly categories: CatalogCategoriesService,
    private readonly purgeLedger: PurgeInstrumentLedgerUseCase,
    private readonly ensureCashInstitution: EnsureCashInstitutionUseCase,
    private readonly userBaseCurrency: ResolveUserBaseCurrencyUseCase,
    private readonly logos: LogoService = fallbackLogos,
    private readonly users: UsersService = fallbackUsers,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Account numbers use their own encryption key. The plaintext never reaches
   * storage.
   */
  private get dataEncryptionKey(): string {
    return this.config.get('DATA_ENCRYPTION_KEY', { infer: true });
  }

  private buildAccountNumberColumns(
    plaintext: string | null,
  ): AccountNumberColumns {
    if (!plaintext) {
      return {
        accountNumber: null,
        accountNumberLast4: null,
        accountNumberHash: null,
      };
    }
    const secret = this.dataEncryptionKey;
    return {
      accountNumber: encryptAccountNumber(plaintext, secret),
      accountNumberLast4: accountNumberLast4(plaintext),
      accountNumberHash: fingerprintAccountNumber(plaintext, secret),
    };
  }

  async listAccounts(userId: string) {
    await this.ensureCashInstitution.execute(userId);
    const accounts = await this.repo.findAccountsByUser(userId);
    const earmarked = await this.repo.sumEarmarkedByAccountIds(
      userId,
      accounts.map((account) => account.id),
    );
    return accounts.map((account) =>
      this.mapAccount(account, earmarked.get(account.id) ?? 0),
    );
  }

  async listAccountsPage(userId: string, query: CursorQueryDto) {
    await this.ensureCashInstitution.execute(userId);
    const rows = await this.repo.findAccountsPage(userId, query);
    const page = toCursorPage(
      rows,
      clampPageLimit(query.limit),
      (row) => row.name,
    );
    const earmarked = await this.repo.sumEarmarkedByAccountIds(
      userId,
      page.items.map((account) => account.id),
    );
    return {
      ...page,
      items: page.items.map((account) =>
        this.mapAccount(account, earmarked.get(account.id) ?? 0),
      ),
    };
  }

  async getAccount(userId: string, id: string) {
    const account = await this.repo.findAccountById(id, userId);
    if (!account) {
      throw new NotFoundException('Cuenta no encontrada');
    }
    const earmarked = await this.repo.sumEarmarkedByAccountIds(userId, [id]);
    return this.mapAccount(account, earmarked.get(id) ?? 0);
  }

  /** Same public shape as `getAccount`, loaded in batch and without throwing. */
  async lookupAccounts(
    userId: string,
    ids: readonly string[],
  ): Promise<Map<string, ReturnType<CatalogService['mapAccount']>>> {
    const rows = await this.repo.findAccountsByIds(userId, ids);
    const earmarked = await this.repo.sumEarmarkedByAccountIds(userId, [
      ...rows.map((row) => row.id),
    ]);
    return new Map(
      rows.map((row) => [
        row.id,
        this.mapAccount(row, earmarked.get(row.id) ?? 0),
      ]),
    );
  }

  async createAccount(userId: string, dto: CreateAccountDto) {
    const institutionId = await this.resolveAccountInstitutionId(
      userId,
      dto.type,
      dto.institutionId,
    );
    const accountNumber = this.assertAccountNumberRule(
      dto.type,
      dto.accountNumber,
    );
    if (dto.type === CASH_ACCOUNT_TYPE && dto.isDefaultForInstitution) {
      throw new BadRequestException(
        'CASH accounts cannot be the default for an institution',
      );
    }
    const rest = omitAccountNumber(dto);
    try {
      if (dto.isDefaultForInstitution) {
        await this.repo.clearDefaultAccount(userId, institutionId);
      }
      return this.mapAccount(
        await this.repo.createAccount(userId, {
          ...rest,
          institutionId,
          ...this.buildAccountNumberColumns(accountNumber),
        }),
      );
    } catch (error) {
      this.rethrowAccountNumberConflict(error);
    }
  }

  async updateAccount(userId: string, id: string, dto: UpdateAccountDto) {
    const existing = await this.repo.findAccountById(id, userId);
    if (!existing) {
      throw new NotFoundException('Cuenta no encontrada');
    }
    if (dto.isActive === false && (await this.repo.hasSavingsGoalMoney(id))) {
      throw new ConflictException({
        code: ACCOUNT_HAS_GOAL_MONEY,
        message: ACCOUNT_HAS_GOAL_MONEY_MESSAGE,
      });
    }

    const nextType = dto.type ?? existing.type;
    const nextInstitutionId = await this.resolveAccountInstitutionId(
      userId,
      nextType,
      dto.institutionId,
      existing.institutionId,
    );
    if (nextType === CASH_ACCOUNT_TYPE && dto.isDefaultForInstitution) {
      throw new BadRequestException(
        'CASH accounts cannot be the default for an institution',
      );
    }

    const clearAccountNumber = nextType === CASH_ACCOUNT_TYPE;
    const accountNumberColumns = this.resolveAccountNumberColumns({
      type: nextType,
      clearAccountNumber,
      requested: dto.accountNumber,
      existingAccountNumber: existing.accountNumber,
    });

    if (
      dto.institutionId !== undefined &&
      nextInstitutionId !== existing.institutionId
    ) {
      await this.ownership.assertAccountInstitutionChangeAllowed({
        userId,
        accountId: id,
        nextInstitutionId,
      });
    }

    const rest = omitAccountNumber(dto);
    try {
      if (dto.isDefaultForInstitution) {
        await this.repo.clearDefaultAccount(userId, nextInstitutionId, id);
      }
      const account = await this.repo.updateAccount(id, userId, {
        ...rest,
        institutionId: nextInstitutionId,
        ...accountNumberColumns,
      });
      if (!account) {
        throw new NotFoundException('Cuenta no encontrada');
      }
      return this.mapAccount(account);
    } catch (error) {
      this.rethrowAccountNumberConflict(error);
    }
  }

  async deleteAccount(userId: string, id: string) {
    const existing = await this.repo.findAccountById(id, userId);
    if (!existing) {
      throw new NotFoundException('Cuenta no encontrada');
    }
    await this.assertCashAccountDeletable(userId, existing);
    const purged = await this.purgeLedger.forAccount(userId, id);
    const removed = await this.repo.deleteAccount({
      userId,
      id,
      movements: purged.rows,
    });
    if (removed.count === 0) {
      throw new NotFoundException('Cuenta no encontrada');
    }
    return { success: true };
  }

  async restoreAccount(userId: string, id: string, now: Date) {
    const restored = await this.repo.restoreAccount(userId, id, now);
    assertRestored(restored, 'Cuenta no encontrada');
    return { success: true };
  }

  async listInstitutionsPage(userId: string, query: CursorQueryDto) {
    await this.ensureCashInstitution.execute(userId);
    const rows = await this.repo.listInstitutions(userId, query);
    const page = toCursorPage(rows, clampPageLimit(query.limit), (row) =>
      institutionOrderKey(row),
    );
    return {
      ...page,
      items: page.items.map((item) => this.mapInstitution(item)),
    };
  }

  async createInstitution(userId: string, dto: CreateInstitutionDto) {
    this.assertNotCashInstitutionType(dto.type);
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
    const existing = await this.repo.findInstitution(userId, id);
    if (!existing) {
      throw new NotFoundException('Institución no encontrada');
    }
    this.assertInstitutionEditable(existing);
    this.assertNotCashInstitutionType(dto.type);
    if (dto.isActive === false) {
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
        throw new NotFoundException('Institución no encontrada');
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
    const existing = await this.repo.findInstitution(userId, id);
    if (!existing) {
      throw new NotFoundException('Institución no encontrada');
    }
    this.assertInstitutionEditable(existing);
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
      throw new NotFoundException('Institución no encontrada');
    }
    return this.mapInstitution(updated);
  }

  async deactivateInstitution(userId: string, id: string) {
    const existing = await this.repo.findInstitution(userId, id);
    if (!existing) {
      throw new NotFoundException('Institución no encontrada');
    }
    this.assertInstitutionEditable(existing);
    await this.ownership.assertInstitutionCanArchive(userId, id);
    const updated = await this.repo.updateInstitution(userId, id, {
      isActive: false,
    });
    if (!updated) {
      throw new NotFoundException('Institución no encontrada');
    }
    return { success: true };
  }

  async deleteInstitution(userId: string, id: string) {
    const existing = await this.repo.findInstitution(userId, id);
    if (!existing) {
      throw new NotFoundException('Institución no encontrada');
    }
    this.assertInstitutionEditable(existing);
    const movements: LedgerTransactionRow[] = [];
    const accounts = await this.repo.listAccountsByInstitution(userId, id);
    for (const account of accounts) {
      const purged = await this.purgeLedger.forAccount(userId, account.id);
      movements.push(...purged.rows);
    }
    const cards = await this.repo.listCardsByInstitution(userId, id);
    for (const card of cards) {
      const purged = await this.purgeLedger.forCard(userId, card.id);
      movements.push(...purged.rows);
    }
    const removed = await this.repo.deleteInstitution({
      userId,
      id,
      movements,
    });
    if (removed.count === 0) {
      throw new NotFoundException('Institución no encontrada');
    }
    return { success: true };
  }

  async restoreInstitution(userId: string, id: string, now: Date) {
    const restored = await this.repo.restoreInstitution(userId, id, now);
    assertRestored(restored, 'Institution not found');
    return { success: true };
  }

  async listCardsPage(userId: string, query: CursorQueryDto) {
    const rows = await this.repo.listCardsPage(userId, query);
    const page = toCursorPage(rows, clampPageLimit(query.limit), (row) =>
      row.createdAt.toISOString(),
    );
    const today = await this.localToday(userId);
    return { ...page, items: page.items.map((c) => this.mapCard(c, today)) };
  }

  async listCards(userId: string) {
    const cards = await this.repo.listCards(userId);
    const today = await this.localToday(userId);
    return cards.map((c) => this.mapCard(c, today));
  }

  async getCard(userId: string, id: string) {
    const card = await this.repo.findCardById(userId, id);
    if (!card) {
      throw new NotFoundException('Tarjeta no encontrada');
    }
    return this.mapCard(card, await this.localToday(userId));
  }

  async createCard(userId: string, dto: CreateCardDto) {
    if (!dto.lastFour) {
      throw new BadRequestException('lastFour es obligatorio');
    }
    await this.ownership.assertInstitutionAcceptsBankProducts(
      userId,
      dto.institutionId,
    );
    if (dto.type === 'DEBIT') {
      if (!dto.accountId) {
        throw new BadRequestException('Las tarjetas DEBIT requieren accountId');
      }
      await this.ownership.assertDebitAccountAlignment({
        userId,
        accountId: dto.accountId,
        institutionId: dto.institutionId,
      });
    }
    if (dto.type === 'CREDIT' && dto.accountId) {
      throw new BadRequestException(
        'Las tarjetas CREDIT no deben llevar accountId',
      );
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
    return this.mapCard(created, await this.localToday(userId));
  }

  async updateCard(userId: string, id: string, dto: UpdateCardDto) {
    const existing = await this.repo.findCardById(userId, id);
    if (!existing) {
      throw new NotFoundException('Tarjeta no encontrada');
    }

    const nextType = dto.type ?? existing.type;
    const nextInstitutionId = dto.institutionId ?? existing.institutionId;
    if (!dto.lastFour && !existing.lastFour) {
      throw new BadRequestException('lastFour es obligatorio');
    }
    if (dto.institutionId) {
      await this.ownership.assertInstitutionAcceptsBankProducts(
        userId,
        dto.institutionId,
      );
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
        throw new BadRequestException('Las tarjetas DEBIT requieren accountId');
      }
      await this.ownership.assertDebitAccountAlignment({
        userId,
        accountId: nextAccountId,
        institutionId: nextInstitutionId,
      });
    }
    if (nextType === 'CREDIT' && dto.accountId) {
      throw new BadRequestException(
        'Las tarjetas CREDIT no deben llevar accountId',
      );
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
      throw new NotFoundException('Tarjeta no encontrada');
    }
    return this.mapCard(updated, await this.localToday(userId));
  }

  async deactivateCard(userId: string, id: string) {
    const updated = await this.repo.updateCard(userId, id, { isActive: false });
    if (!updated) {
      throw new NotFoundException('Tarjeta no encontrada');
    }
    return { success: true };
  }

  async deleteCard(userId: string, id: string) {
    const existing = await this.repo.findCardById(userId, id);
    if (!existing) {
      throw new NotFoundException('Tarjeta no encontrada');
    }
    const purged = await this.purgeLedger.forCard(userId, id);
    const removed = await this.repo.deleteCard({
      userId,
      id,
      movements: purged.rows,
    });
    if (removed.count === 0) {
      throw new NotFoundException('Tarjeta no encontrada');
    }
    return { success: true };
  }

  async restoreCard(userId: string, id: string, now: Date) {
    const restored = await this.repo.restoreCard(userId, id, now);
    assertRestored(restored, 'Card not found');
    return { success: true };
  }

  async updateCardBalance(
    userId: string,
    id: string,
    dto: UpdateCardBalanceDto,
  ) {
    const card = await this.repo.findCardById(userId, id);
    if (!card) {
      throw new NotFoundException('Tarjeta no encontrada');
    }
    if (card.type === 'DEBIT') {
      throw new BadRequestException(
        'DEBIT cards use their linked account balance',
      );
    }
    if (card.type === 'CREDIT' && dto.creditLimit === undefined) {
      throw new BadRequestException(
        'Las tarjetas CREDIT requieren creditLimit',
      );
    }
    const updated = await this.repo.upsertCardBalance(
      userId,
      id,
      dto.currency.toUpperCase(),
      dto.balance,
      dto.creditLimit,
    );
    if (!updated) {
      throw new NotFoundException('Tarjeta no encontrada');
    }
    return {
      id: updated.id,
      cardId: updated.cardId,
      currency: updated.currency,
      balance: decimalToString(updated.balance),
      creditLimit: decimalToNullableString(updated.creditLimit),
    };
  }

  async updateCardCreditLimit(
    userId: string,
    id: string,
    dto: { currency: string; creditLimit: number },
  ) {
    const card = await this.repo.findCardById(userId, id);
    if (!card) {
      throw new NotFoundException('Tarjeta no encontrada');
    }
    if (card.type !== 'CREDIT') {
      throw new BadRequestException(
        'Solo las tarjetas de crédito tienen límite',
      );
    }
    const updated = await this.repo.setCardCreditLimit(
      userId,
      id,
      dto.currency,
      dto.creditLimit,
    );
    if (!updated) {
      throw new NotFoundException('Tarjeta no encontrada');
    }
    return {
      id: updated.id,
      cardId: updated.cardId,
      currency: updated.currency,
      balance: decimalToString(updated.balance),
      creditLimit: decimalToNullableString(updated.creditLimit),
    };
  }

  async deleteCardBalance(userId: string, id: string, currency: string) {
    const card = await this.repo.findCardById(userId, id);
    if (!card) {
      throw new NotFoundException('Tarjeta no encontrada');
    }
    if (card.type === 'DEBIT') {
      throw new BadRequestException(
        'DEBIT cards use their linked account balance',
      );
    }
    const result = await this.repo.deleteCardBalance(userId, id, currency);
    if (result.count === 0) {
      throw new NotFoundException('Saldo de tarjeta no encontrado');
    }
    return { success: true };
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
  private async resolveAccountInstitutionId(
    userId: string,
    type: string,
    requestedInstitutionId: string | undefined,
    fallbackInstitutionId: string | null = null,
  ): Promise<string> {
    if (type === CASH_ACCOUNT_TYPE) {
      return this.resolveCashInstitutionId(userId, requestedInstitutionId);
    }
    const institutionId = requestedInstitutionId ?? fallbackInstitutionId;
    if (!institutionId) {
      throw new BadRequestException(
        'CHECKING, SAVINGS, and INVESTMENT accounts require institutionId',
      );
    }
    await this.ownership.assertInstitutionAcceptsBankProducts(
      userId,
      institutionId,
    );
    return institutionId;
  }

  /**
   * Cash only lives in the system "Efectivo". The command ensures it exists;
   * the id is then read through the repository query (CQS).
   */
  private async resolveCashInstitutionId(
    userId: string,
    requestedInstitutionId: string | undefined,
  ): Promise<string> {
    await this.ensureCashInstitution.execute(userId);
    const cash = await this.repo.findSystemCashInstitution(userId);
    if (!cash) {
      throw new NotFoundException('Efectivo no está disponible');
    }
    if (requestedInstitutionId && requestedInstitutionId !== cash.id) {
      throw new BadRequestException(
        'Las cuentas de efectivo van dentro de Efectivo',
      );
    }
    return cash.id;
  }

  private assertInstitutionEditable(institution: { isSystem: boolean }) {
    if (institution.isSystem) {
      throw new ForbiddenException(
        'La institución Efectivo es de sistema: no se puede editar ni borrar',
      );
    }
  }

  private assertNotCashInstitutionType(type: string | undefined) {
    if (type !== undefined && isCashInstitution({ type })) {
      throw new BadRequestException(
        'Efectivo ya existe como institución de sistema',
      );
    }
  }

  /**
   * The base-currency "Efectivo" account is the user's anchor: it can be
   * deactivated but never hard-deleted (decision approved on 2026-10-15).
   */
  private async assertCashAccountDeletable(
    userId: string,
    account: { type: string; currency: string },
  ) {
    if (account.type !== CASH_ACCOUNT_TYPE) {
      return;
    }
    const baseCurrency = await this.userBaseCurrency.execute(userId);
    if (normalizeCurrencyCode(account.currency) === baseCurrency) {
      throw new BadRequestException(
        'La cuenta Efectivo de la moneda base no se puede borrar; desactívala',
      );
    }
  }

  private resolveAccountNumberColumns(params: {
    type: string;
    clearAccountNumber: boolean;
    requested: string | null | undefined;
    existingAccountNumber: string | null;
  }): AccountNumberColumns | Partial<AccountNumberColumns> {
    const { type, clearAccountNumber, requested, existingAccountNumber } =
      params;
    if (clearAccountNumber) {
      this.assertAccountNumberRule(type, requested);
      return this.buildAccountNumberColumns(null);
    }
    if (requested !== undefined) {
      return this.buildAccountNumberColumns(
        this.assertAccountNumberRule(type, requested),
      );
    }
    if (existingAccountNumber === null) {
      this.assertAccountNumberRule(type, null);
    }
    return {};
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
    earmarkedAmount = 0,
  ) {
    const freeBalance = roundMoney(Number(account.balance) - earmarkedAmount);
    return {
      id: account.id,
      institutionId: account.institutionId,
      institutionName: account.institutionRef?.name ?? null,
      institutionLogoUrl: this.logos.resolveUrl(account.institutionRef),
      institutionColor: account.institutionRef?.color ?? null,
      name: account.name,
      type: account.type,
      currency: account.currency,
      accountNumberLast4: account.accountNumberLast4,
      isDefaultForInstitution: account.isDefaultForInstitution,
      balance: decimalToString(account.balance),
      earmarkedAmount: decimalToString(earmarkedAmount),
      freeBalance: decimalToString(freeBalance),
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
      isSystem: institution.isSystem,
    };
  }

  private async localToday(userId: string): Promise<Date> {
    const profile = await this.users.findById(userId);
    return localDayStart(profile.timezone, new Date());
  }

  /** Same public shape as the card detail, loaded in batch and without throwing. */
  async lookupCards(
    userId: string,
    ids: readonly string[],
  ): Promise<Map<string, ReturnType<CatalogService['mapCard']>>> {
    const rows = await this.repo.findCardsByIds(userId, ids);
    if (rows.length === 0) {
      return new Map<string, ReturnType<CatalogService['mapCard']>>();
    }
    const today = await this.localToday(userId);
    return new Map(rows.map((row) => [row.id, this.mapCard(row, today)]));
  }

  private mapCard(card: CardRow, today: Date) {
    const cycle = buildNextCardCycle({
      closingDay: card.statementClosingDay,
      dueDay: card.paymentDueDay,
      today,
    });
    return {
      id: card.id,
      institutionId: card.institutionId,
      institutionName: card.institution.name,
      institutionLogoUrl: this.logos.resolveUrl(card.institution),
      institutionColor: card.institution.color ?? null,
      networkLogoUrl: this.logos.networkLogoUrl(card.network),
      accountId: card.accountId,
      accountName: card.account?.name ?? null,
      name: card.name,
      type: card.type,
      network: card.network,
      lastFour: card.lastFour,
      statementClosingDay: card.statementClosingDay,
      paymentDueDay: card.paymentDueDay,
      nextStatementDate: cycle ? isoDay(cycle.statementDate) : null,
      nextPaymentDueDate: cycle?.paymentDueDate
        ? isoDay(cycle.paymentDueDate)
        : null,
      color: card.color,
      isActive: card.isActive,
      balances: card.balances.map((balance) =>
        mapCardBalance(balance, card.transactions),
      ),
    };
  }
}
