import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { clampPageLimit, decodeCursor, toCursorPage } from '@personal-os/core';
import type { Prisma } from '@personal-os/database';
import { PrismaService } from '@personal-os/database';
import { LogoService, type LogoUploadFile } from '@personal-os/logos';
import {
  DEFAULT_MODULE_CONFIG_BY_SLUG,
  mergeWithDefaults,
  USERS_REPOSITORY,
  type UsersRepositoryPort,
} from '@personal-os/users';
import { ResolveAmountsUseCase } from '../../fx/application/resolve-amounts.use-case';
import { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import { normalizeMerchant } from '../../merchants/domain/normalize-merchant';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import type { SubscriptionMatcherPort } from '../../shared/application/subscription-matcher.port';
import { roundMoney } from '../../shared/domain/money';
import {
  annualCost,
  daysUntil,
  firstBillingOnOrAfter,
  monthlyCost,
  nextBillingAfter,
  type BillingCycle,
} from '../domain/billing';
import { matchesSubscription } from '../domain/payment-matching';
import {
  SubscriptionsRepository,
  type SubscriptionRow,
} from '../infrastructure/subscriptions.repository';
import type { CreateSubscriptionDto } from '../presentation/dto/create-subscription.dto';
import type { CreateSubscriptionPaymentDto } from '../presentation/dto/create-subscription-payment.dto';
import type { ListSubscriptionsQueryDto } from '../presentation/dto/list-subscriptions-query.dto';
import type { UpdateSubscriptionDto } from '../presentation/dto/update-subscription.dto';

const FINANCE_MODULE_SLUG = 'finance';
const UPCOMING_WINDOW_DAYS = 7;
const DEFAULT_REMINDER_DAYS = 3;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateOnly(value: Date): Date {
  return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

@Injectable()
export class SubscriptionsService implements SubscriptionMatcherPort {
  constructor(
    private readonly repo: SubscriptionsRepository,
    private readonly prisma: PrismaService,
    private readonly logos: LogoService,
    private readonly ownership: FinanceOwnershipService,
    private readonly baseCurrency: ResolveUserBaseCurrencyUseCase,
    private readonly resolveAmounts: ResolveAmountsUseCase,
    @Inject(USERS_REPOSITORY)
    private readonly usersRepository: UsersRepositoryPort,
  ) {}

  async list(
    userId: string,
    query: ListSubscriptionsQueryDto,
    now = new Date(),
  ) {
    const limit = clampPageLimit(query.limit);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await this.repo.list(userId, {
      cursor,
      take: limit + 1,
      status: query.status,
      currency: query.currency?.toUpperCase(),
      search: query.q,
    });
    const page = toCursorPage(rows, limit, (row) =>
      row.nextBillingDate.toISOString(),
    );
    return {
      ...page,
      items: page.items.map((row) => this.map(row, now)),
    };
  }

  async summary(userId: string, now = new Date()) {
    const active = await this.repo.findActive(userId);
    const baseCurrency = await this.baseCurrency.execute(userId);
    const byCurrency = new Map<string, { monthly: number; annual: number }>();
    for (const row of active) {
      const amount = Number(row.amount);
      const bucket = byCurrency.get(row.currency) ?? { monthly: 0, annual: 0 };
      bucket.monthly += monthlyCost({
        amount,
        cycle: row.billingCycle,
        interval: row.billingInterval,
      });
      bucket.annual += annualCost({
        amount,
        cycle: row.billingCycle,
        interval: row.billingInterval,
      });
      byCurrency.set(row.currency, bucket);
    }

    let monthlyTotal = 0;
    let annualTotal = 0;
    for (const [currency, bucket] of byCurrency) {
      monthlyTotal += await this.resolveAmounts.toBaseCurrency(
        bucket.monthly,
        currency,
        baseCurrency,
        now,
      );
      annualTotal += await this.resolveAmounts.toBaseCurrency(
        bucket.annual,
        currency,
        baseCurrency,
        now,
      );
    }

    return {
      baseCurrency,
      activeCount: active.length,
      monthlyCost: roundMoney(monthlyTotal).toFixed(2),
      annualCost: roundMoney(annualTotal).toFixed(2),
      upcoming: active
        .map((row) => ({ row, days: daysUntil(row.nextBillingDate, now) }))
        .filter(
          (entry) => entry.days >= 0 && entry.days <= UPCOMING_WINDOW_DAYS,
        )
        .sort((left, right) => left.days - right.days)
        .map((entry) => ({
          ...this.map(entry.row, now),
          daysUntil: entry.days,
        })),
    };
  }

  async get(userId: string, id: string, now = new Date()) {
    const row = await this.repo.findById(userId, id);
    if (!row) {
      throw new NotFoundException('Subscription not found');
    }
    return this.map(row, now);
  }

  async create(userId: string, dto: CreateSubscriptionDto, now = new Date()) {
    await this.assertTargets(userId, dto.cardId, dto.accountId);
    if (dto.sourcePatternId) {
      await this.assertPatternOwned(userId, dto.sourcePatternId);
    }
    const domain = dto.domain?.trim() || null;
    const interval = dto.billingInterval ?? 1;
    const anchorDate = dateOnly(new Date(dto.anchorDate));
    const created = await this.repo.create(userId, {
      name: dto.name.trim(),
      normalizedKey: this.normalizedKeyFor(dto.name),
      domain,
      logoPath: domain ? await this.logos.ensureLogo(domain) : null,
      amount: roundMoney(dto.amount),
      currency:
        dto.currency?.toUpperCase() ??
        (await this.baseCurrency.execute(userId)),
      billingCycle: dto.billingCycle,
      billingInterval: interval,
      anchorDate,
      nextBillingDate: this.nextBillingFromSchedule({
        anchor: anchorDate,
        cycle: dto.billingCycle,
        interval,
        now,
      }),
      trialEndsAt: dto.trialEndsAt ? dateOnly(new Date(dto.trialEndsAt)) : null,
      status: 'ACTIVE',
      reminderDaysBefore:
        dto.reminderDaysBefore ?? (await this.defaultReminderDays(userId)),
      cardId: dto.cardId ?? null,
      accountId: dto.accountId ?? null,
      manageUrl: dto.manageUrl?.trim() || null,
      notes: dto.notes?.trim() || null,
      sourcePatternId: dto.sourcePatternId ?? null,
    });
    return this.map(created, now);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateSubscriptionDto,
    now = new Date(),
  ) {
    const existing = await this.repo.findById(userId, id);
    if (!existing) {
      throw new NotFoundException('Subscription not found');
    }
    await this.assertTargets(userId, dto.cardId, dto.accountId);

    const name = dto.name?.trim() ?? existing.name;
    const cycle = dto.billingCycle ?? existing.billingCycle;
    const interval = dto.billingInterval ?? existing.billingInterval;
    const anchorDate = dto.anchorDate
      ? dateOnly(new Date(dto.anchorDate))
      : existing.anchorDate;
    const scheduleChanged =
      dto.anchorDate !== undefined ||
      dto.billingCycle !== undefined ||
      dto.billingInterval !== undefined;

    const changes: Prisma.FinSubscriptionUncheckedUpdateInput = {
      name,
      normalizedKey: this.normalizedKeyFor(name),
    };
    if (dto.domain !== undefined) {
      const domain = dto.domain?.trim() || null;
      changes.domain = domain;
      changes.logoPath = domain ? await this.logos.ensureLogo(domain) : null;
    }
    if (dto.amount !== undefined) {
      changes.amount = roundMoney(dto.amount);
    }
    if (dto.currency !== undefined) {
      changes.currency = dto.currency.toUpperCase();
    }
    if (dto.billingCycle !== undefined) {
      changes.billingCycle = cycle;
    }
    if (dto.billingInterval !== undefined) {
      changes.billingInterval = interval;
    }
    if (dto.anchorDate !== undefined) {
      changes.anchorDate = anchorDate;
    }
    if (scheduleChanged) {
      changes.nextBillingDate = this.nextBillingFromSchedule({
        anchor: anchorDate,
        cycle,
        interval,
        now,
      });
    }
    if (dto.trialEndsAt !== undefined) {
      changes.trialEndsAt = dto.trialEndsAt
        ? dateOnly(new Date(dto.trialEndsAt))
        : null;
    }
    if (dto.reminderDaysBefore !== undefined) {
      changes.reminderDaysBefore = dto.reminderDaysBefore;
    }
    if (dto.cardId !== undefined) {
      changes.cardId = dto.cardId;
    }
    if (dto.accountId !== undefined) {
      changes.accountId = dto.accountId;
    }
    if (dto.manageUrl !== undefined) {
      changes.manageUrl = dto.manageUrl?.trim() || null;
    }
    if (dto.notes !== undefined) {
      changes.notes = dto.notes?.trim() || null;
    }
    if (dto.status !== undefined) {
      this.applyStatus(changes, dto.status, now);
      // Resuming restarts the schedule from today, same as the resume endpoint.
      if (dto.status === 'ACTIVE' && existing.status !== 'ACTIVE') {
        changes.nextBillingDate = this.nextBillingFromSchedule({
          anchor: anchorDate,
          cycle,
          interval,
          now,
        });
      }
    }
    const updated = await this.repo.update(userId, id, changes);
    if (!updated) {
      throw new NotFoundException('Subscription not found');
    }
    return this.map(updated, now);
  }

  async pause(userId: string, id: string, now = new Date()) {
    const changes: Prisma.FinSubscriptionUncheckedUpdateInput = {};
    this.applyStatus(changes, 'PAUSED', now);
    const updated = await this.repo.update(userId, id, changes);
    if (!updated) {
      throw new NotFoundException('Subscription not found');
    }
    return this.map(updated, now);
  }

  async resume(userId: string, id: string, now = new Date()) {
    const existing = await this.repo.findById(userId, id);
    if (!existing) {
      throw new NotFoundException('Subscription not found');
    }
    const updated = await this.repo.update(userId, id, {
      status: 'ACTIVE',
      pausedAt: null,
      cancelledAt: null,
      nextBillingDate: this.nextBillingFromSchedule({
        anchor: existing.anchorDate,
        cycle: existing.billingCycle,
        interval: existing.billingInterval,
        now,
      }),
    });
    if (!updated) {
      throw new NotFoundException('Subscription not found');
    }
    return this.map(updated, now);
  }

  async cancel(userId: string, id: string, now = new Date()) {
    const changes: Prisma.FinSubscriptionUncheckedUpdateInput = {};
    this.applyStatus(changes, 'CANCELLED', now);
    const updated = await this.repo.update(userId, id, changes);
    if (!updated) {
      throw new NotFoundException('Subscription not found');
    }
    return this.map(updated, now);
  }

  async listPayments(
    userId: string,
    id: string,
    query: { limit?: number; cursor?: string },
  ) {
    const subscription = await this.repo.findById(userId, id);
    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }
    const limit = clampPageLimit(query.limit);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await this.repo.listPayments(userId, id, {
      cursor,
      take: limit + 1,
    });
    const page = toCursorPage(rows, limit, (row) => row.paidAt.toISOString());
    return {
      ...page,
      items: page.items.map((row) => ({
        id: row.id,
        amount: row.amount.toFixed(2),
        currency: row.currency,
        paidAt: row.paidAt.toISOString(),
        source: row.source,
        transactionId: row.transactionId,
        transaction: row.transaction
          ? {
              id: row.transaction.id,
              merchant: row.transaction.merchant,
              amount: row.transaction.amount.toFixed(2),
              currency: row.transaction.currency,
              transactionDate: row.transaction.transactionDate.toISOString(),
              accountName: row.transaction.account?.name ?? null,
              cardName: row.transaction.card?.name ?? null,
            }
          : null,
      })),
    };
  }

  async recordManualPayment(
    userId: string,
    id: string,
    dto: CreateSubscriptionPaymentDto,
    now = new Date(),
  ) {
    const subscription = await this.repo.findById(userId, id);
    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }
    if (dto.transactionId) {
      const transaction = await this.repo.findTransaction(
        userId,
        dto.transactionId,
      );
      if (!transaction) {
        throw new BadRequestException('Transaction not found');
      }
      const alreadyLinked = await this.repo.findPaymentByTransaction(
        id,
        dto.transactionId,
      );
      if (alreadyLinked) {
        throw new ConflictException(
          'This movement is already registered for the subscription',
        );
      }
    }
    const payment = await this.repo.createPayment({
      subscriptionId: id,
      transactionId: dto.transactionId ?? null,
      amount: roundMoney(dto.amount ?? Number(subscription.amount)),
      currency: dto.currency?.toUpperCase() ?? subscription.currency,
      paidAt: dto.paidAt ? new Date(dto.paidAt) : now,
      source: 'MANUAL',
    });
    if (subscription.status === 'ACTIVE') {
      await this.advanceBilling(subscription);
    }
    return {
      id: payment.id,
      amount: payment.amount.toFixed(2),
      currency: payment.currency,
      paidAt: payment.paidAt.toISOString(),
      source: payment.source,
    };
  }

  async uploadLogo(userId: string, id: string, file: LogoUploadFile) {
    const subscription = await this.repo.findById(userId, id);
    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }
    const customLogoPath = await this.logos.saveCustomLogo(userId, id, file);
    const updated = await this.repo.update(userId, id, { customLogoPath });
    if (!updated) {
      throw new NotFoundException('Subscription not found');
    }
    return { logoUrl: this.logos.resolveUrl(updated) };
  }

  async matchTransaction(input: {
    userId: string;
    transactionId: string;
  }): Promise<void> {
    const transaction = await this.repo.findTransaction(
      input.userId,
      input.transactionId,
    );
    if (!transaction || transaction.status !== 'CONFIRMED') {
      return;
    }
    if (transaction.type !== 'DEBIT') {
      return;
    }
    const active = await this.repo.findActive(input.userId);
    const candidates = active.filter((row) =>
      matchesSubscription({
        subscription: {
          id: row.id,
          normalizedKey: row.normalizedKey,
          amount: Number(row.amount),
          currency: row.currency,
          nextBillingDate: row.nextBillingDate,
        },
        transaction: {
          merchant: transaction.merchant,
          amount: Number(transaction.amount),
          currency: transaction.currency,
          transactionDate: transaction.transactionDate,
        },
      }),
    );
    if (candidates.length !== 1) {
      return;
    }
    const subscription = candidates[0];
    const existingPayment = await this.repo.findPaymentByTransaction(
      subscription.id,
      transaction.id,
    );
    if (existingPayment) {
      return;
    }
    await this.repo.createPayment({
      subscriptionId: subscription.id,
      transactionId: transaction.id,
      amount: Number(transaction.amount),
      currency: transaction.currency,
      paidAt: transaction.transactionDate,
      source: 'AUTO',
    });
    await this.advanceBilling(subscription);
  }

  private applyStatus(
    changes: Prisma.FinSubscriptionUncheckedUpdateInput,
    status: 'ACTIVE' | 'PAUSED' | 'CANCELLED',
    now: Date,
  ): void {
    changes.status = status;
    if (status === 'CANCELLED') {
      changes.cancelledAt = now;
      changes.pausedAt = null;
      return;
    }
    if (status === 'PAUSED') {
      changes.pausedAt = now;
      changes.cancelledAt = null;
      return;
    }
    changes.pausedAt = null;
    changes.cancelledAt = null;
  }

  private nextBillingFromSchedule(input: {
    anchor: Date;
    cycle: BillingCycle;
    interval: number;
    now: Date;
  }): Date {
    return dateOnly(
      firstBillingOnOrAfter(
        { anchor: input.anchor, cycle: input.cycle, interval: input.interval },
        input.now,
      ),
    );
  }

  private async advanceBilling(subscription: SubscriptionRow): Promise<void> {
    await this.repo.update(subscription.userId, subscription.id, {
      nextBillingDate: dateOnly(
        nextBillingAfter(
          {
            anchor: subscription.anchorDate,
            cycle: subscription.billingCycle,
            interval: subscription.billingInterval,
          },
          subscription.nextBillingDate,
        ),
      ),
    });
  }

  private async assertTargets(
    userId: string,
    cardId?: string,
    accountId?: string,
  ): Promise<void> {
    if (cardId) {
      await this.ownership.assertCardOwned(userId, cardId);
    }
    if (accountId) {
      await this.ownership.assertAccountOwned(userId, accountId);
    }
  }

  private async assertPatternOwned(
    userId: string,
    patternId: string,
  ): Promise<void> {
    const pattern = await this.prisma.finRecurringPattern.findFirst({
      where: { id: patternId, userId },
      select: { id: true },
    });
    if (!pattern) {
      throw new BadRequestException('Recurring pattern not found');
    }
  }

  private normalizedKeyFor(name: string): string {
    const key = normalizeMerchant(name);
    if (!key) {
      throw new BadRequestException('Subscription name is required');
    }
    return key;
  }

  private async defaultReminderDays(userId: string): Promise<number> {
    const row = await this.usersRepository.findUserModuleBySlug(
      userId,
      FINANCE_MODULE_SLUG,
    );
    const config = mergeWithDefaults(
      row?.config,
      DEFAULT_MODULE_CONFIG_BY_SLUG.finance as unknown as Record<
        string,
        unknown
      >,
    ) as { subscriptions?: { reminderDaysBefore?: unknown } };
    const value = config.subscriptions?.reminderDaysBefore;
    return typeof value === 'number' ? value : DEFAULT_REMINDER_DAYS;
  }

  private map(row: SubscriptionRow, now: Date) {
    const amount = Number(row.amount);
    const cycle = row.billingCycle;
    return {
      id: row.id,
      name: row.name,
      normalizedKey: row.normalizedKey,
      domain: row.domain,
      logoUrl: this.logos.resolveUrl(row),
      amount: row.amount.toFixed(2),
      currency: row.currency,
      billingCycle: cycle,
      billingInterval: row.billingInterval,
      anchorDate: isoDate(row.anchorDate),
      nextBillingDate: isoDate(row.nextBillingDate),
      trialEndsAt: row.trialEndsAt ? isoDate(row.trialEndsAt) : null,
      status: row.status,
      pausedAt: row.pausedAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      reminderDaysBefore: row.reminderDaysBefore,
      lastRemindedFor: row.lastRemindedFor
        ? isoDate(row.lastRemindedFor)
        : null,
      cardId: row.cardId,
      cardName: row.card?.name ?? null,
      accountId: row.accountId,
      accountName: row.account?.name ?? null,
      manageUrl: row.manageUrl,
      notes: row.notes,
      sourcePatternId: row.sourcePatternId,
      monthlyEquivalent: monthlyCost({
        amount,
        cycle,
        interval: row.billingInterval,
      }).toFixed(2),
      annualEquivalent: annualCost({
        amount,
        cycle,
        interval: row.billingInterval,
      }).toFixed(2),
      daysUntil: daysUntil(row.nextBillingDate, now),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
