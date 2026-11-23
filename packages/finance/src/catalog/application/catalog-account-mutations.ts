import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@personal-os/database';
import { CASH_ACCOUNT_TYPE } from '../../shared/domain/cash';
import {
  ACCOUNT_HAS_GOAL_MONEY,
  ACCOUNT_HAS_GOAL_MONEY_MESSAGE,
} from '../../shared/domain/savings-goal';
import { CatalogAccountRepository } from '../infrastructure/catalog-account.repository';
import type { CreateAccountDto } from '../presentation/dto/create-account.dto';
import type { UpdateAccountDto } from '../presentation/dto/update-account.dto';
import { CatalogAccountNumbersService } from './catalog-account-numbers.service';
import { CatalogAccountRules } from './catalog-account-rules';

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

/** Account writes: creation and edition with their institution and number. */
@Injectable()
export class CatalogAccountMutations {
  constructor(
    private readonly repo: CatalogAccountRepository,
    private readonly rules: CatalogAccountRules,
    private readonly numbers: CatalogAccountNumbersService,
  ) {}

  async createAccount(userId: string, dto: CreateAccountDto) {
    const institutionId = await this.rules.resolveInstitution({
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
      return this.repo.createAccount(userId, {
        ...rest,
        institutionId,
        ...accountNumberColumns,
      });
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
    const nextInstitutionId = await this.rules.resolveInstitution({
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
      await this.rules.assertInstitutionChangeAllowed({
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
      return account;
    } catch (error) {
      this.rethrowAccountNumberConflict(error);
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
