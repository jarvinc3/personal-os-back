import { Prisma } from '@personal-os/database';
import { LogoService } from '@personal-os/logos';
import { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import { roundDecimal } from '../../shared/domain/money';
import type { BillingCycle } from '../domain/billing';
import type { CreateSubscriptionDto } from '../presentation/dto/create-subscription.dto';
import type { UpdateSubscriptionDto } from '../presentation/dto/update-subscription.dto';
import { dateOnly } from './subscription-dates';
import { SubscriptionReminderWindow } from './subscription-reminder-window';
import {
  applySubscriptionStatus,
  nextBillingFromSchedule,
  normalizedKeyFor,
  type SubscriptionSchedule,
  type SubscriptionStatus,
  type UpdateSubscriptionChanges,
} from './subscription-write-rules';

type CreateSubscriptionData = Omit<
  Prisma.FinSubscriptionUncheckedCreateInput,
  'userId'
>;

type ExistingSubscription = {
  name: string;
  billingCycle: BillingCycle;
  billingInterval: number;
  anchorDate: Date;
  status: SubscriptionStatus;
};

type ScheduleFields = {
  billingCycle: BillingCycle;
  billingInterval: number;
  anchorDate: Date;
  nextBillingDate: Date;
};

/** Builds the Prisma payload of every subscription write, one method per use. */
export class SubscriptionChanges {
  constructor(
    private readonly logos: LogoService,
    private readonly baseCurrency: ResolveUserBaseCurrencyUseCase,
    private readonly reminderWindow: SubscriptionReminderWindow,
  ) {}

  async forCreate(
    userId: string,
    dto: CreateSubscriptionDto,
    now: Date,
  ): Promise<CreateSubscriptionData> {
    const anchorDate = dateOnly(new Date(dto.anchorDate));
    const interval = dto.billingInterval ?? 1;
    const domain = dto.domain?.trim() || null;
    return {
      name: dto.name.trim(),
      normalizedKey: normalizedKeyFor(dto.name),
      domain,
      logoPath: await this.logoPath(domain),
      amount: roundDecimal(dto.amount),
      currency: await this.currencyFor(userId, dto.currency),
      ...this.scheduleFields({
        anchorDate,
        cycle: dto.billingCycle,
        interval,
        now,
      }),
      trialEndsAt: this.optionalDate(dto.trialEndsAt),
      status: 'ACTIVE',
      reminderDaysBefore: await this.reminderDaysFor(
        userId,
        dto.reminderDaysBefore,
      ),
      cardId: dto.cardId ?? null,
      accountId: dto.accountId ?? null,
      categoryId: dto.categoryId ?? null,
      sourcePatternId: dto.sourcePatternId ?? null,
      manageUrl: dto.manageUrl?.trim() || null,
      notes: dto.notes?.trim() || null,
    };
  }

  async forUpdate(
    existing: ExistingSubscription,
    dto: UpdateSubscriptionDto,
    now: Date,
  ): Promise<UpdateSubscriptionChanges> {
    const schedule = {
      cycle: dto.billingCycle ?? existing.billingCycle,
      interval: dto.billingInterval ?? existing.billingInterval,
      anchorDate: dto.anchorDate
        ? dateOnly(new Date(dto.anchorDate))
        : existing.anchorDate,
      now,
    };
    const name = dto.name?.trim() ?? existing.name;
    return {
      name,
      normalizedKey: normalizedKeyFor(name),
      ...(await this.domainFields(dto.domain)),
      ...this.amountFields(dto.amount),
      ...this.currencyFields(dto.currency),
      ...this.cycleFields(schedule, dto),
      ...this.trialFields(dto.trialEndsAt),
      ...this.reminderFields(dto.reminderDaysBefore),
      ...this.assignmentFields(dto),
      ...this.contentFields(dto),
      ...this.statusFields(existing.status, dto.status, schedule),
    };
  }

  forStatus(status: SubscriptionStatus, now: Date): UpdateSubscriptionChanges {
    const changes: UpdateSubscriptionChanges = {};
    applySubscriptionStatus(changes, status, now);
    return changes;
  }

  forResume(
    existing: ExistingSubscription,
    now: Date,
  ): UpdateSubscriptionChanges {
    return {
      status: 'ACTIVE',
      pausedAt: null,
      cancelledAt: null,
      nextBillingDate: nextBillingFromSchedule({
        anchorDate: existing.anchorDate,
        cycle: existing.billingCycle,
        interval: existing.billingInterval,
        now,
      }),
    };
  }

  private async logoPath(domain: string | null): Promise<string | null> {
    if (!domain) {
      return null;
    }
    return this.logos.ensureLogo(domain);
  }

  private async currencyFor(
    userId: string,
    currency: string | undefined,
  ): Promise<string> {
    return currency?.toUpperCase() ?? this.baseCurrency.execute(userId);
  }

  private async reminderDaysFor(
    userId: string,
    reminderDaysBefore: number | undefined,
  ): Promise<number> {
    return reminderDaysBefore ?? this.reminderWindow.resolve(userId);
  }

  private optionalDate(value: string | undefined): Date | null {
    return value ? dateOnly(new Date(value)) : null;
  }

  private scheduleFields(schedule: SubscriptionSchedule): ScheduleFields {
    return {
      billingCycle: schedule.cycle,
      billingInterval: schedule.interval,
      anchorDate: schedule.anchorDate,
      nextBillingDate: nextBillingFromSchedule(schedule),
    };
  }

  private async domainFields(
    domain: string | undefined,
  ): Promise<UpdateSubscriptionChanges> {
    if (domain === undefined) {
      return {};
    }
    const trimmed = domain.trim() || null;
    return {
      domain: trimmed,
      logoPath: await this.logoPath(trimmed),
    };
  }

  private amountFields(amount: number | undefined): UpdateSubscriptionChanges {
    if (amount === undefined) {
      return {};
    }
    return { amount: roundDecimal(amount) };
  }

  private currencyFields(
    currency: string | undefined,
  ): UpdateSubscriptionChanges {
    if (currency === undefined) {
      return {};
    }
    return { currency: currency.toUpperCase() };
  }

  private cycleFields(
    schedule: SubscriptionSchedule,
    dto: UpdateSubscriptionDto,
  ): UpdateSubscriptionChanges {
    const fields: UpdateSubscriptionChanges = {};
    if (dto.billingCycle !== undefined) {
      fields.billingCycle = schedule.cycle;
    }
    if (dto.billingInterval !== undefined) {
      fields.billingInterval = schedule.interval;
    }
    if (dto.anchorDate !== undefined) {
      fields.anchorDate = schedule.anchorDate;
    }
    if (
      dto.anchorDate !== undefined ||
      dto.billingCycle !== undefined ||
      dto.billingInterval !== undefined
    ) {
      fields.nextBillingDate = nextBillingFromSchedule(schedule);
    }
    return fields;
  }

  private trialFields(
    trialEndsAt: string | undefined,
  ): UpdateSubscriptionChanges {
    if (trialEndsAt === undefined) {
      return {};
    }
    return { trialEndsAt: this.optionalDate(trialEndsAt) };
  }

  private reminderFields(
    reminderDaysBefore: number | undefined,
  ): UpdateSubscriptionChanges {
    if (reminderDaysBefore === undefined) {
      return {};
    }
    return { reminderDaysBefore };
  }

  private assignmentFields(
    dto: UpdateSubscriptionDto,
  ): UpdateSubscriptionChanges {
    const fields: UpdateSubscriptionChanges = {};
    if (dto.cardId !== undefined) {
      fields.cardId = dto.cardId;
    }
    if (dto.accountId !== undefined) {
      fields.accountId = dto.accountId;
    }
    if (dto.categoryId !== undefined) {
      fields.categoryId = dto.categoryId;
    }
    return fields;
  }

  private contentFields(dto: UpdateSubscriptionDto): UpdateSubscriptionChanges {
    const fields: UpdateSubscriptionChanges = {};
    if (dto.manageUrl !== undefined) {
      fields.manageUrl = dto.manageUrl?.trim() || null;
    }
    if (dto.notes !== undefined) {
      fields.notes = dto.notes?.trim() || null;
    }
    return fields;
  }

  private statusFields(
    existingStatus: SubscriptionStatus,
    status: UpdateSubscriptionDto['status'],
    schedule: SubscriptionSchedule,
  ): UpdateSubscriptionChanges {
    if (status === undefined) {
      return {};
    }
    const changes: UpdateSubscriptionChanges = {};
    applySubscriptionStatus(changes, status, schedule.now);
    if (status === 'ACTIVE' && existingStatus !== 'ACTIVE') {
      changes.nextBillingDate = nextBillingFromSchedule(schedule);
    }
    return changes;
  }
}
