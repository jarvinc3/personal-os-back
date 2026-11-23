import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@personal-os/database';
import { normalizeMerchant } from '../../merchants/domain/normalize-merchant';
import { firstBillingOnOrAfter, type BillingCycle } from '../domain/billing';
import { dateOnly } from './subscription-dates';

export type SubscriptionStatus = 'ACTIVE' | 'PAUSED' | 'CANCELLED';

export type SubscriptionSchedule = {
  cycle: BillingCycle;
  interval: number;
  anchorDate: Date;
  now: Date;
};

export type UpdateSubscriptionChanges =
  Prisma.FinSubscriptionUncheckedUpdateInput;

export function normalizedKeyFor(name: string): string {
  const key = normalizeMerchant(name);
  if (!key) {
    throw new BadRequestException('El nombre de la suscripción es obligatorio');
  }
  return key;
}

export function subscriptionStatusFields(
  status: SubscriptionStatus,
  now: Date,
): UpdateSubscriptionChanges {
  if (status === 'CANCELLED') {
    return { status, cancelledAt: now, pausedAt: null };
  }
  if (status === 'PAUSED') {
    return { status, pausedAt: now, cancelledAt: null };
  }
  return { status, pausedAt: null, cancelledAt: null };
}

export function nextBillingFromSchedule(schedule: SubscriptionSchedule): Date {
  return dateOnly(
    firstBillingOnOrAfter(
      {
        anchor: schedule.anchorDate,
        cycle: schedule.cycle,
        interval: schedule.interval,
      },
      schedule.now,
    ),
  );
}
