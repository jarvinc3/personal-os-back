import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { clampPageLimit, decodeCursor, toCursorPage } from '@personal-os/core';
import type { Prisma } from '@personal-os/database';
import { MerchantsService } from '../../merchants/application/merchants.service';
import { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { decimalToString } from '../../shared/domain/mappers';
import {
  DEFAULT_AMOUNT_TOLERANCE_PCT,
  detectRecurringPattern,
  type RecurringPeriodicity,
} from '../domain/recurring-detection';
import {
  annualAmount,
  daysUntil,
  hasPriceIncrease,
  monthlyAmount,
  upcomingPatterns,
} from '../domain/recurring-alerts';
import {
  RecurringRepository,
  type DetectionCharge,
} from '../infrastructure/recurring.repository';
import type { CreateRecurringDto } from '../presentation/dto/create-recurring.dto';
import type {
  ListRecurringQueryDto,
  UpcomingRecurringQueryDto,
} from '../presentation/dto/list-recurring-query.dto';
import type { UpdateRecurringDto } from '../presentation/dto/update-recurring.dto';

/** Long enough to see three annual charges. */
export const DETECTION_LOOKBACK_DAYS = 1100;
/** A confirmed pattern accepts any amount, so a price change refreshes it
 * instead of dropping it. The stored tolerance keeps the alert band. */
const CONFIRMED_DETECTION_TOLERANCE_PCT = 100;
const MS_PER_DAY = 86_400_000;

export type RecurringPatternWithMerchant =
  Prisma.FinRecurringPatternGetPayload<{ include: { merchantRef: true } }>;

export type RecurringPriceChange = {
  patternId: string;
  merchant: string;
  currency: string;
  previousAmount: number;
  newAmount: number;
};

export type RecurringDetectionOutcome = {
  patterns: RecurringPatternWithMerchant[];
  priceChanges: RecurringPriceChange[];
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function mapPattern(row: RecurringPatternWithMerchant, now: Date) {
  const frequency = Number(row.frequency) as RecurringPeriodicity;
  return {
    id: row.id,
    merchantId: row.merchantId,
    merchant: row.merchant,
    merchantName: row.merchantRef?.name ?? row.merchant,
    logoUrl: row.merchantRef?.logoUrl ?? null,
    categoryId: row.categoryId,
    avgAmount: decimalToString(row.avgAmount),
    currency: row.currency,
    frequency,
    nextExpectedDate: isoDate(row.nextExpectedDate),
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    status: row.status,
    kind: row.kind,
    confidenceScore: row.confidenceScore,
    amountTolerancePct: Number(row.amountTolerance),
    monthlyEquivalent: monthlyAmount(row.avgAmount, frequency).toFixed(2),
    annualEquivalent: annualAmount(row.avgAmount, frequency).toFixed(2),
    daysUntil: daysUntil(row.nextExpectedDate, now),
  };
}

@Injectable()
export class RecurringService {
  constructor(
    private readonly repo: RecurringRepository,
    private readonly merchants: MerchantsService,
    private readonly ownership: FinanceOwnershipService,
    private readonly baseCurrency: ResolveUserBaseCurrencyUseCase,
  ) {}

  async list(userId: string, query: ListRecurringQueryDto, now = new Date()) {
    const limit = clampPageLimit(query.limit);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await this.repo.listPatterns(userId, {
      cursor,
      take: limit + 1,
      status: query.status,
    });
    const page = toCursorPage(rows, limit, (row) =>
      row.nextExpectedDate.toISOString(),
    );
    return {
      ...page,
      items: page.items.map((row) => mapPattern(row, now)),
    };
  }

  async upcoming(
    userId: string,
    query: UpcomingRecurringQueryDto,
    now = new Date(),
  ) {
    const patterns = await this.repo.findConfirmedPatterns(userId);
    return upcomingPatterns(patterns, { today: now, days: query.days }).map(
      (entry) => ({
        ...mapPattern(entry.pattern, now),
        daysUntil: entry.daysUntil,
      }),
    );
  }

  async create(userId: string, dto: CreateRecurringDto, now = new Date()) {
    if (dto.categoryId) {
      await this.ownership.assertCategoryVisible(userId, dto.categoryId);
    }
    const resolved = await this.resolveMerchant(userId, dto);
    if (!resolved && !dto.merchant?.trim()) {
      throw new BadRequestException('merchant or merchantId is required');
    }
    const created = await this.repo.createPattern(userId, {
      merchantId: resolved?.id ?? null,
      merchant: resolved?.name ?? dto.merchant?.trim() ?? '',
      categoryId: dto.categoryId ?? resolved?.categoryId ?? null,
      avgAmount: dto.avgAmount,
      currency: dto.currency ?? (await this.baseCurrency.execute(userId)),
      frequency: String(dto.frequency),
      nextExpectedDate: new Date(dto.nextExpectedDate),
      status: 'CONFIRMED',
      kind: dto.kind ?? 'SUBSCRIPTION',
      confirmedAt: now,
      amountTolerance: DEFAULT_AMOUNT_TOLERANCE_PCT,
    });
    return mapPattern(created, now);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateRecurringDto,
    now = new Date(),
  ) {
    const existing = await this.repo.findPatternById(userId, id);
    if (!existing) {
      throw new NotFoundException('Recurring pattern not found');
    }
    if (dto.categoryId) {
      await this.ownership.assertCategoryVisible(userId, dto.categoryId);
    }
    const changes: Prisma.FinRecurringPatternUncheckedUpdateInput = {};
    if (dto.merchant !== undefined) {
      const resolved = await this.merchants.resolve(userId, dto.merchant);
      changes.merchant = resolved?.name ?? dto.merchant.trim();
      changes.merchantId = resolved?.id ?? null;
    }
    if (dto.categoryId !== undefined) {
      changes.categoryId = dto.categoryId;
    }
    if (dto.avgAmount !== undefined) {
      changes.avgAmount = dto.avgAmount;
    }
    if (dto.currency !== undefined) {
      changes.currency = dto.currency;
    }
    if (dto.frequency !== undefined) {
      changes.frequency = String(dto.frequency);
    }
    if (dto.nextExpectedDate !== undefined) {
      changes.nextExpectedDate = new Date(dto.nextExpectedDate);
    }
    if (dto.kind !== undefined) {
      changes.kind = dto.kind;
    }
    if (dto.amountTolerancePct !== undefined) {
      changes.amountTolerance = dto.amountTolerancePct;
    }
    if (dto.status !== undefined) {
      changes.status = dto.status;
      changes.confirmedAt = dto.status === 'CONFIRMED' ? now : null;
    }
    const updated = await this.repo.updatePattern(userId, id, changes);
    if (!updated) {
      throw new NotFoundException('Recurring pattern not found');
    }
    return mapPattern(updated, now);
  }

  /** Detects new patterns and refreshes the confirmed ones. */
  async detect(
    userId: string,
    now = new Date(),
  ): Promise<RecurringDetectionOutcome> {
    const since = new Date(
      now.getTime() - DETECTION_LOOKBACK_DAYS * MS_PER_DAY,
    );
    const charges = await this.repo.findChargesForDetection(userId, since);
    const currency = await this.baseCurrency.execute(userId);
    const priceChanges: RecurringPriceChange[] = [];

    for (const group of groupCharges(charges)) {
      const kind = group.type === 'CREDIT' ? 'INCOME' : 'SUBSCRIPTION';
      const existing = await this.repo.findPatternByMerchantAndKind(
        userId,
        group.merchantId,
        kind,
      );
      if (existing?.status === 'DISMISSED') {
        continue;
      }
      const allowTwoOccurrences =
        existing?.status === 'CONFIRMED' && Number(existing.frequency) === 365;
      const confirmed = existing?.status === 'CONFIRMED';
      const storedTolerance = Number(
        existing?.amountTolerance ?? DEFAULT_AMOUNT_TOLERANCE_PCT,
      );
      const detected = detectRecurringPattern({
        merchantId: group.merchantId,
        merchantName: group.charges[0].merchantName || group.merchantId,
        currency: existing?.currency ?? currency,
        categoryId: existing?.categoryId ?? group.charges[0].categoryId,
        charges: group.charges.map((charge) => ({
          id: charge.id,
          amount: charge.amount,
          date: charge.transactionDate,
        })),
        today: now,
        amountTolerancePct: confirmed
          ? CONFIRMED_DETECTION_TOLERANCE_PCT
          : storedTolerance,
        allowTwoOccurrences,
      });
      if (!detected) {
        continue;
      }
      if (existing) {
        await this.repo.updatePattern(userId, existing.id, {
          merchant: detected.merchantName,
          avgAmount: detected.avgAmount,
          currency: detected.currency,
          frequency: String(detected.frequency),
          nextExpectedDate: detected.nextExpectedDate,
          lastSeenAt: detected.lastSeenAt,
          confidenceScore: detected.confidenceScore,
          amountTolerance: storedTolerance,
          categoryId: existing.categoryId ?? detected.categoryId,
        });
        if (confirmed) {
          const priceChange = this.detectPriceChange(
            existing,
            lastChargeAmount(group.charges),
          );
          if (priceChange) {
            priceChanges.push(priceChange);
          }
        }
        continue;
      }
      await this.repo.createPattern(userId, {
        merchantId: detected.merchantId,
        merchant: detected.merchantName,
        categoryId: detected.categoryId,
        avgAmount: detected.avgAmount,
        currency: detected.currency,
        frequency: String(detected.frequency),
        nextExpectedDate: detected.nextExpectedDate,
        lastSeenAt: detected.lastSeenAt,
        confidenceScore: detected.confidenceScore,
        amountTolerance: detected.amountTolerancePct,
        status: 'SUGGESTED',
        kind,
      });
    }

    const patterns = await this.repo.findConfirmedPatterns(userId);
    return { patterns, priceChanges };
  }

  private detectPriceChange(
    existing: RecurringPatternWithMerchant,
    newAmount: number,
  ): RecurringPriceChange | null {
    const previousAmount = Number(existing.avgAmount);
    if (
      !hasPriceIncrease({
        lastAmount: newAmount,
        avgAmount: previousAmount,
        tolerancePct: Number(existing.amountTolerance),
      })
    ) {
      return null;
    }
    return {
      patternId: existing.id,
      merchant: existing.merchant,
      currency: existing.currency,
      previousAmount,
      newAmount,
    };
  }

  private async resolveMerchant(userId: string, dto: CreateRecurringDto) {
    if (dto.merchantId) {
      const merchant = await this.merchants.get(userId, dto.merchantId);
      return {
        id: merchant.id,
        name: merchant.name,
        categoryId: merchant.categoryId,
      };
    }
    return this.merchants.resolve(userId, dto.merchant);
  }
}

function lastChargeAmount(charges: DetectionCharge[]): number {
  return charges[charges.length - 1].amount;
}

function groupCharges(charges: DetectionCharge[]) {
  const groups = new Map<
    string,
    {
      merchantId: string;
      type: 'DEBIT' | 'CREDIT';
      charges: DetectionCharge[];
    }
  >();
  for (const charge of charges) {
    const key = `${charge.merchantId}:${charge.type}`;
    const group = groups.get(key) ?? {
      merchantId: charge.merchantId,
      type: charge.type,
      charges: [],
    };
    group.charges.push(charge);
    groups.set(key, group);
  }
  return [...groups.values()];
}
