import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@personal-os/database';
import { clampPageLimit, toCursorPage } from '@personal-os/core';
import type { CursorQueryDto } from '@personal-os/core';
import { EnsureCashInstitutionUseCase } from './ensure-cash-institution.use-case';
import { PurgeInstrumentLedgerUseCase } from '../../ledger/application/purge-instrument-ledger.use-case';
import { assertRestored } from '../../shared/application/assert-restored';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { CASH_ACCOUNT_TYPE } from '../../shared/domain/cash';
import { normalizeCurrencyCode } from '../../shared/domain/money';
import {
  ACCOUNT_HAS_GOAL_MONEY,
  ACCOUNT_HAS_GOAL_MONEY_MESSAGE,
} from '../../shared/domain/savings-goal';
import { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import { CatalogAccountRepository } from '../infrastructure/catalog-account.repository';
import { CatalogCashRepository } from '../infrastructure/catalog-cash.repository';
import type { CreateAccountDto } from '../presentation/dto/create-account.dto';
import type { UpdateAccountDto } from '../presentation/dto/update-account.dto';
import { CatalogAccountNumbersService } from './catalog-account-numbers.service';
import { CatalogViews } from './catalog-views';

type AccountDetailRow = NonNullable<
  Awaited<ReturnType<CatalogAccountRepository['findAccountById']>>
>;

type InstitutionResolution = {
  userId: string;
  type: string;
  requestedInstitutionId: string | undefined;
  fallbackInstitutionId?: string | null;
};

function omitAccountNumber<
  T extends {
    accountNumber?: string | null;
    accountNumberLast4?: string | null;
  },
>(dto: T): Omit<T, 'accountNumber' | 'accountNumberLast4'> {
  const { accountNumber, accountNumberLast4, ...rest } = dto;
  void accountNumber;
  void accountNumberLast4;
  return rest;
}

/** Accounts: their lifecycle, institution rules and encrypted number. */
@Injectable()
export class CatalogAccountsService {
  constructor(
    private readonly repo: CatalogAccountRepository,
    private readonly cashRepo: CatalogCashRepository,
    private readonly ownership: FinanceOwnershipService,
    private readonly purgeLedger: PurgeInstrumentLedgerUseCase,
    private readonly ensureCashInstitution: EnsureCashInstitutionUseCase,
    private readonly userBaseCurrency: ResolveUserBaseCurrencyUseCase,
    private readonly numbers: CatalogAccountNumbersService,
    private readonly views: CatalogViews,
  ) {}

  async listAccounts(userId: string) {
    await this.ensureCashInstitution.execute(userId);
    const accounts = await this.repo.findAccountsByUser(userId);
    const earmarked = await this.repo.sumEarmarkedByAccountIds(
      userId,
      accounts.map((account) => account.id),
    );
    return accounts.map((account) =>
      this.views.account(account, earmarked.get(account.id) ?? 0),
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
        this.views.account(account, earmarked.get(account.id) ?? 0),
      ),
    };
  }

  async getAccount(userId: string, id: string) {
    const account = await this.repo.findAccountById(id, userId);
    if (!account) {
      throw new NotFoundException('Cuenta no encontrada');
    }
    const earmarked = await this.repo.sumEarmarkedByAccountIds(userId, [id]);
    return this.views.account(account, earmarked.get(id) ?? 0);
  }

  /** Same public shape as `getAccount`, loaded in batch and without throwing. */
  async lookupAccounts(userId: string, ids: readonly string[]) {
    const rows = await this.repo.findAccountsByIds(userId, ids);
    const earmarked = await this.repo.sumEarmarkedByAccountIds(userId, [
      ...rows.map((row) => row.id),
    ]);
    return new Map(
      rows.map((row) => [
        row.id,
        this.views.account(row, earmarked.get(row.id) ?? 0),
      ]),
    );
  }

  async createAccount(userId: string, dto: CreateAccountDto) {
    const institutionId = await this.resolveAccountInstitutionId({
      userId,
      type: dto.type,
      requestedInstitutionId: dto.institutionId,
    });
    const accountNumberColumns = this.numbers.buildColumns(
      dto.type,
      dto.accountNumber,
      dto.accountNumberLast4,
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
      return this.views.account(
        await this.repo.createAccount(userId, {
          ...rest,
          institutionId,
          ...accountNumberColumns,
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
    const nextInstitutionId = await this.resolveAccountInstitutionId({
      userId,
      type: nextType,
      requestedInstitutionId: dto.institutionId,
      fallbackInstitutionId: existing.institutionId,
    });
    if (nextType === CASH_ACCOUNT_TYPE && dto.isDefaultForInstitution) {
      throw new BadRequestException(
        'CASH accounts cannot be the default for an institution',
      );
    }

    const accountNumberColumns = this.numbers.resolveColumns({
      type: nextType,
      clearAccountNumber: nextType === CASH_ACCOUNT_TYPE,
      requested: dto.accountNumber,
      requestedLastFour: dto.accountNumberLast4,
      existingAccountNumber: existing.accountNumber,
      existingLastFour: existing.accountNumberLast4,
      existingType: existing.type,
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
      return this.views.account(account);
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

  private async resolveAccountInstitutionId(
    params: InstitutionResolution,
  ): Promise<string> {
    if (params.type === CASH_ACCOUNT_TYPE) {
      return this.resolveCashInstitutionId({
        userId: params.userId,
        requestedInstitutionId: params.requestedInstitutionId,
      });
    }
    const institutionId =
      params.requestedInstitutionId ?? params.fallbackInstitutionId;
    if (!institutionId) {
      throw new BadRequestException(
        'CHECKING, SAVINGS, and INVESTMENT accounts require institutionId',
      );
    }
    await this.ownership.assertInstitutionAcceptsBankProducts(
      params.userId,
      institutionId,
    );
    return institutionId;
  }

  /**
   * Cash only lives in the system "Efectivo". The command ensures it exists;
   * the id is then read through the repository query (CQS).
   */
  private async resolveCashInstitutionId({
    userId,
    requestedInstitutionId,
  }: {
    userId: string;
    requestedInstitutionId: string | undefined;
  }): Promise<string> {
    await this.ensureCashInstitution.execute(userId);
    const cash = await this.cashRepo.findSystemCashInstitution(userId);
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

  /**
   * The base-currency "Efectivo" account is the user's anchor: it can be
   * deactivated but never hard-deleted (decision approved on 2026-10-15).
   */
  private async assertCashAccountDeletable(
    userId: string,
    account: Pick<AccountDetailRow, 'type' | 'currency'>,
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
}
