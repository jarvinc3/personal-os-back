import { Injectable } from '@nestjs/common';
import { PrismaService } from '@personal-os/database';
import type { RoutedSignal } from '@personal-os/contracts';
import { LedgerQueryService } from '../ledger/application/ledger-query.service';
import {
  isAtmMovementClass,
  type MovementClass,
} from '../ledger/domain/movement-class';
import { MerchantsService } from '../merchants/application/merchants.service';
import {
  resolveCategoryIdForImport,
  type CategoryResolveSource,
} from '../shared/domain/category-type';
import type { SignalCandidate } from './signal-import-payload';

type CategoryResolutionInput = {
  signal: RoutedSignal;
  candidate: SignalCandidate;
  movementClass: MovementClass;
  transfer: boolean;
  type: 'DEBIT' | 'CREDIT';
};

type CategoryResolution = {
  categoryId: string | null;
  source: CategoryResolveSource | null;
};

/** Category a movement draft starts with: hint, merchant suggestion or history. */
@Injectable()
export class SignalMovementCategory {
  constructor(
    private readonly prisma: PrismaService,
    private readonly merchants: MerchantsService,
    private readonly ledger: LedgerQueryService,
  ) {}

  async resolve({
    signal,
    candidate,
    movementClass,
    transfer,
    type,
  }: CategoryResolutionInput): Promise<CategoryResolution> {
    if (transfer || isAtmMovementClass(movementClass)) {
      return { categoryId: null, source: null };
    }
    const categories = await this.prisma.finCategory.findMany({
      where: {
        type: type === 'DEBIT' ? 'EXPENSE' : 'INCOME',
        OR: [{ userId: signal.userId }, { isSystem: true }],
      },
      select: { id: true, name: true, type: true },
    });
    return resolveCategoryIdForImport({
      categories,
      hint: candidate.categoryNameHint ?? null,
      transactionType: type,
      merchant: candidate.merchant ?? null,
      findMerchantCategoryId: async (merchant) =>
        (await this.merchants.suggest(signal.userId, merchant))?.categoryId ??
        null,
      findCategoryIdByMerchant: (merchant) =>
        this.ledger.findLatestCategoryIdByMerchant(signal.userId, merchant),
    });
  }
}
