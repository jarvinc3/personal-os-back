import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@personal-os/database';
import { MerchantsService } from '../../merchants/application/merchants.service';
import { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { DEFAULT_AMOUNT_TOLERANCE_PCT } from '../domain/recurring-detection';
import { RecurringRepository } from '../infrastructure/recurring.repository';
import type { CreateRecurringDto } from '../presentation/dto/create-recurring.dto';
import type { UpdateRecurringDto } from '../presentation/dto/update-recurring.dto';
import { mapPattern } from './recurring-mappers';
import type { RecurringPatternWithMerchant } from './recurring-types';

type MerchantReference = {
  id: string;
  name: string;
  categoryId: string | null;
};

type UpdateRecurringCommand = {
  userId: string;
  id: string;
  dto: UpdateRecurringDto;
  now?: Date;
};

/** Creates and edits recurring patterns with their merchant and category. */
@Injectable()
export class RecurringWriteService {
  // The merchant resolver, the ownership checks and the base currency are
  // independent collaborators of the same write flow.
  // eslint-disable-next-line max-params
  constructor(
    private readonly repo: RecurringRepository,
    private readonly merchants: MerchantsService,
    private readonly ownership: FinanceOwnershipService,
    private readonly baseCurrency: ResolveUserBaseCurrencyUseCase,
  ) {}

  async create(userId: string, dto: CreateRecurringDto, now = new Date()) {
    if (dto.categoryId) {
      await this.ownership.assertCategoryVisible(userId, dto.categoryId);
    }
    const created = await this.repo.createPattern(
      userId,
      await this.createFields({ userId, dto, now }),
    );
    return mapPattern(created, now);
  }

  async update({ userId, id, dto, now = new Date() }: UpdateRecurringCommand) {
    const existing = await this.repo.findPatternById(userId, id);
    if (!existing) {
      throw new NotFoundException('Patrón recurrente no encontrado');
    }
    if (dto.categoryId) {
      await this.ownership.assertCategoryVisible(userId, dto.categoryId);
    }
    const changes = await this.buildChanges({ userId, dto, existing, now });
    const updated = await this.repo.updatePattern(userId, id, changes);
    if (!updated) {
      throw new NotFoundException('Patrón recurrente no encontrado');
    }
    return mapPattern(updated, now);
  }

  private async createFields(input: {
    userId: string;
    dto: CreateRecurringDto;
    now: Date;
  }) {
    const { userId, dto, now } = input;
    const resolved = await this.resolveMerchant(userId, dto);
    if (!resolved && !dto.merchant?.trim()) {
      throw new BadRequestException('merchant o merchantId es obligatorio');
    }
    return {
      ...this.merchantFields({ resolved, dto }),
      avgAmount: dto.avgAmount,
      currency: dto.currency ?? (await this.baseCurrency.execute(userId)),
      frequency: String(dto.frequency),
      nextExpectedDate: new Date(dto.nextExpectedDate),
      status: 'CONFIRMED' as const,
      kind: dto.kind ?? 'SUBSCRIPTION',
      confirmedAt: now,
      amountTolerance: DEFAULT_AMOUNT_TOLERANCE_PCT,
    };
  }

  private merchantFields(input: {
    resolved: MerchantReference | null;
    dto: CreateRecurringDto;
  }) {
    const { resolved, dto } = input;
    return {
      merchantId: resolved?.id ?? null,
      merchant: resolved?.name ?? dto.merchant?.trim() ?? '',
      categoryId: dto.categoryId ?? resolved?.categoryId ?? null,
    };
  }

  private async buildChanges(input: {
    userId: string;
    dto: UpdateRecurringDto;
    existing: RecurringPatternWithMerchant;
    now: Date;
  }): Promise<Prisma.FinRecurringPatternUncheckedUpdateInput> {
    return {
      ...(await this.merchantChanges(input)),
      ...this.catalogChanges(input.dto),
      ...this.amountChanges(input.dto),
      ...this.scheduleChanges(input.dto),
      ...this.statusChanges(input),
    };
  }

  private async merchantChanges(input: {
    userId: string;
    dto: UpdateRecurringDto;
    existing: RecurringPatternWithMerchant;
  }): Promise<Prisma.FinRecurringPatternUncheckedUpdateInput> {
    const { userId, dto, existing } = input;
    if (dto.merchant === undefined) {
      return {};
    }
    const resolved = await this.merchants.resolve({
      userId,
      rawName: dto.merchant,
      categoryId: dto.categoryId ?? existing.categoryId,
      transactionType: existing.kind === 'INCOME' ? 'CREDIT' : 'DEBIT',
    });
    return {
      merchant: resolved?.name ?? dto.merchant.trim(),
      merchantId: resolved?.id ?? null,
    };
  }

  private catalogChanges(
    dto: UpdateRecurringDto,
  ): Prisma.FinRecurringPatternUncheckedUpdateInput {
    return {
      ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
      ...(dto.kind !== undefined ? { kind: dto.kind } : {}),
    };
  }

  private amountChanges(
    dto: UpdateRecurringDto,
  ): Prisma.FinRecurringPatternUncheckedUpdateInput {
    return {
      ...(dto.avgAmount !== undefined ? { avgAmount: dto.avgAmount } : {}),
      ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
      ...(dto.amountTolerancePct !== undefined
        ? { amountTolerance: dto.amountTolerancePct }
        : {}),
    };
  }

  private scheduleChanges(
    dto: UpdateRecurringDto,
  ): Prisma.FinRecurringPatternUncheckedUpdateInput {
    return {
      ...(dto.frequency !== undefined
        ? { frequency: String(dto.frequency) }
        : {}),
      ...(dto.nextExpectedDate !== undefined
        ? { nextExpectedDate: new Date(dto.nextExpectedDate) }
        : {}),
    };
  }

  private statusChanges(input: {
    dto: UpdateRecurringDto;
    now: Date;
  }): Prisma.FinRecurringPatternUncheckedUpdateInput {
    const { dto, now } = input;
    if (dto.status === undefined) {
      return {};
    }
    return {
      status: dto.status,
      confirmedAt: dto.status === 'CONFIRMED' ? now : null,
    };
  }

  private async resolveMerchant(
    userId: string,
    dto: CreateRecurringDto,
  ): Promise<MerchantReference | null> {
    if (dto.merchantId) {
      const merchant = await this.merchants.get(userId, dto.merchantId);
      return {
        id: merchant.id,
        name: merchant.name,
        categoryId: merchant.categoryId,
      };
    }
    return this.merchants.resolve({
      userId,
      rawName: dto.merchant,
      categoryId: dto.categoryId ?? null,
      transactionType: dto.kind === 'INCOME' ? 'CREDIT' : 'DEBIT',
    });
  }
}
