import { Injectable } from '@nestjs/common';
import { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import {
  DEFAULT_AMOUNT_TOLERANCE_PCT,
  detectRecurringPattern,
  type DetectRecurringInput,
} from '../domain/recurring-detection';
import { hasPriceIncrease } from '../domain/recurring-alerts';
import {
  RecurringRepository,
  type DetectionCharge,
} from '../infrastructure/recurring.repository';
import type {
  RecurringDetectionOutcome,
  RecurringPatternWithMerchant,
  RecurringPriceChange,
} from './recurring-types';

/** Long enough to see three annual charges. */
export const DETECTION_LOOKBACK_DAYS = 1100;
/** A confirmed pattern accepts any amount, so a price change refreshes it
 * instead of dropping it. The stored tolerance keeps the alert band. */
const CONFIRMED_DETECTION_TOLERANCE_PCT = 100;
const MS_PER_DAY = 86_400_000;

type ChargeGroup = {
  merchantId: string;
  type: 'DEBIT' | 'CREDIT';
  charges: DetectionCharge[];
};

type DetectedPattern = NonNullable<ReturnType<typeof detectRecurringPattern>>;

/** Detects new patterns from the user's charges and refreshes the confirmed ones. */
@Injectable()
export class RecurringDetectionService {
  constructor(
    private readonly repo: RecurringRepository,
    private readonly baseCurrency: ResolveUserBaseCurrencyUseCase,
  ) {}

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
      const priceChange = await this.detectGroup({
        userId,
        group,
        currency,
        now,
      });
      if (priceChange) {
        priceChanges.push(priceChange);
      }
    }
    const patterns = await this.repo.findConfirmedPatterns(userId);
    return { patterns, priceChanges };
  }

  private async detectGroup(input: {
    userId: string;
    group: ChargeGroup;
    currency: string;
    now: Date;
  }): Promise<RecurringPriceChange | null> {
    const { userId, group, currency, now } = input;
    const kind = group.type === 'CREDIT' ? 'INCOME' : 'SUBSCRIPTION';
    const existing = await this.repo.findPatternByMerchantAndKind(
      userId,
      group.merchantId,
      kind,
    );
    if (existing?.status === 'DISMISSED') {
      return null;
    }
    const confirmed = existing?.status === 'CONFIRMED';
    const storedTolerance = Number(
      existing?.amountTolerance ?? DEFAULT_AMOUNT_TOLERANCE_PCT,
    );
    const detected = detectRecurringPattern(
      this.detectionInput({
        existing,
        group,
        currency,
        now,
        confirmed,
        storedTolerance,
      }),
    );
    if (!detected) {
      return null;
    }
    if (!existing) {
      await this.createSuggestedPattern({ userId, detected, kind });
      return null;
    }
    await this.refreshPattern({ userId, existing, detected, storedTolerance });
    if (!confirmed) {
      return null;
    }
    return this.detectPriceChange(existing, lastChargeAmount(group.charges));
  }

  private detectionInput(input: {
    existing: RecurringPatternWithMerchant | null;
    group: ChargeGroup;
    currency: string;
    now: Date;
    confirmed: boolean;
    storedTolerance: number;
  }): DetectRecurringInput {
    const { existing, group, currency, now, confirmed, storedTolerance } =
      input;
    return {
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
      allowTwoOccurrences:
        existing?.status === 'CONFIRMED' && Number(existing.frequency) === 365,
    };
  }

  private createSuggestedPattern(input: {
    userId: string;
    detected: DetectedPattern;
    kind: 'INCOME' | 'SUBSCRIPTION';
  }): Promise<unknown> {
    const { userId, detected, kind } = input;
    return this.repo.createPattern(userId, {
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

  private async refreshPattern(input: {
    userId: string;
    existing: RecurringPatternWithMerchant;
    detected: DetectedPattern;
    storedTolerance: number;
  }): Promise<void> {
    const { userId, existing, detected, storedTolerance } = input;
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
}

function lastChargeAmount(charges: DetectionCharge[]): number {
  return charges[charges.length - 1].amount;
}

function groupCharges(charges: DetectionCharge[]): ChargeGroup[] {
  const groups = new Map<string, ChargeGroup>();
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
