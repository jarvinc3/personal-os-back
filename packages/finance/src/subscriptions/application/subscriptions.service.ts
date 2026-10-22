import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { clampPageLimit, decodeCursor, toCursorPage } from '@personal-os/core';
import { Prisma, PrismaService } from '@personal-os/database';
import { LogoService, type LogoUploadFile } from '@personal-os/logos';
import {
  resolveSubscriptionReminderDays,
  USERS_REPOSITORY,
  type UsersRepositoryPort,
} from '@personal-os/users';
import { ResolveAmountsUseCase } from '../../fx/application/resolve-amounts.use-case';
import { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import { normalizeMerchant } from '../../merchants/domain/normalize-merchant';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import type { SubscriptionMatcherPort } from '../../shared/application/subscription-matcher.port';
import {
  normalizeCurrencyCode,
  ratioPercent,
  roundDecimal,
  scalarNumber,
  toMoney,
} from '../../shared/domain/money';
import {
  annualCost,
  billingOccurrencesInRange,
  daysUntil,
  firstBillingOnOrAfter,
  monthlyCost,
  nextBillingAfter,
  type BillingCycle,
} from '../domain/billing';
import { matchesSubscription } from '../domain/payment-matching';
import {
  DEFAULT_SUBSCRIPTION_SORT,
  isValidSubscriptionCursorKey,
  subscriptionCursorKey,
} from '../domain/subscription-list';
import {
  buildSubscriptionAlerts,
  lastChargeMismatch,
  type SubscriptionAlert,
} from '../domain/subscription-alerts';
import {
  SubscriptionsRepository,
  type SubscriptionRow,
} from '../infrastructure/subscriptions.repository';
import type { CreateSubscriptionDto } from '../presentation/dto/create-subscription.dto';
import type { CreateSubscriptionPaymentDto } from '../presentation/dto/create-subscription-payment.dto';
import type { DismissSubscriptionAlertDto } from '../presentation/dto/dismiss-subscription-alert.dto';
import type { ListSubscriptionsQueryDto } from '../presentation/dto/list-subscriptions-query.dto';
import type { SubscriptionBreakdown } from '../presentation/dto/subscription-breakdown-query.dto';
import type { UpcomingSubscriptionsQueryDto } from '../presentation/dto/upcoming-subscriptions-query.dto';
import type { UpdateSubscriptionDto } from '../presentation/dto/update-subscription.dto';

const FINANCE_MODULE_SLUG = 'finance';
const UPCOMING_DEFAULT_DAYS = 30;
const UNCATEGORIZED_KEY = 'uncategorized';
const NO_INSTRUMENT_KEY = 'no-instrument';
const UNCATEGORIZED_LABEL = 'Sin categoría';
const NO_INSTRUMENT_LABEL = 'Sin método';

type SubscriptionPaymentRow = Prisma.FinSubscriptionPaymentGetPayload<object>;

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
    const sort = query.sort ?? DEFAULT_SUBSCRIPTION_SORT;
    const cursor = query.cursor
      ? decodeCursor(query.cursor, (key) =>
          isValidSubscriptionCursorKey(sort, key),
        )
      : null;
    const rows = await this.repo.list(userId, {
      cursor,
      take: limit + 1,
      status: query.status,
      currency: query.currency?.toUpperCase(),
      categoryId: query.categoryId,
      categoryIds: query.categoryIds,
      frequency: query.frequency,
      sort,
      cardId: query.cardId,
      accountId: query.accountId,
      unassignedCategory: query.unassignedCategory,
      unassignedMethod: query.unassignedMethod,
      search: query.q,
    });
    const page = toCursorPage(rows, limit, (row) =>
      subscriptionCursorKey({
        sort,
        nextBillingDate: row.nextBillingDate,
        amount: row.amount.toFixed(2),
        name: row.name,
      }),
    );
    return {
      ...page,
      items: page.items.map((row) => this.map(row, now)),
    };
  }

  async summary(userId: string, now = new Date()) {
    const active = await this.repo.findActive(userId);
    const baseCurrency = await this.baseCurrency.execute(userId);
    const payments = this.groupPaymentsBySubscription(
      await this.repo.listPaymentsForSubscriptions(active.map((row) => row.id)),
    );

    const monthlyBuckets = new Map<string, Prisma.Decimal>();
    const annualBuckets = new Map<string, Prisma.Decimal>();
    const previousBuckets = new Map<string, Prisma.Decimal>();
    const activeByCurrency = new Map<string, number>();
    for (const row of active) {
      const amount = toMoney(row.amount);
      const cycle = row.billingCycle;
      const interval = row.billingInterval;
      const currency = normalizeCurrencyCode(row.currency);
      activeByCurrency.set(currency, (activeByCurrency.get(currency) ?? 0) + 1);
      this.addToBucket(
        monthlyBuckets,
        currency,
        monthlyCost({ amount, cycle, interval }),
      );
      this.addToBucket(
        annualBuckets,
        currency,
        annualCost({ amount, cycle, interval }),
      );
      // The previous price is the charge before the newest one; without a
      // second payment the subscription has not changed price yet.
      const history = payments.get(row.id) ?? [];
      const previousAmount = history[1] ? toMoney(history[1].amount) : amount;
      this.addToBucket(
        previousBuckets,
        currency,
        monthlyCost({ amount: previousAmount, cycle, interval }),
      );
    }

    const monthlyTotal = await this.sumBucketsInBase(
      monthlyBuckets,
      baseCurrency,
      now,
    );
    const annualTotal = await this.sumBucketsInBase(
      annualBuckets,
      baseCurrency,
      now,
    );
    const previousMonthlyTotal = await this.sumBucketsInBase(
      previousBuckets,
      baseCurrency,
      now,
    );

    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const nextMonthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );
    const previousMonthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
    );
    const [
      thisMonthPayments,
      previousMonthPayments,
      cancelled,
      pendingDetectedCount,
    ] = await Promise.all([
      this.repo.listPaymentsInRange(userId, monthStart, nextMonthStart),
      this.repo.listPaymentsInRange(userId, previousMonthStart, monthStart),
      this.repo.findByStatus(userId, 'CANCELLED'),
      this.repo.countPendingDetected(userId),
    ]);
    const realSpendThisMonth = await this.sumPaymentsInBase(
      thisMonthPayments,
      baseCurrency,
    );
    const realSpendPreviousMonth = await this.sumPaymentsInBase(
      previousMonthPayments,
      baseCurrency,
    );
    const cancelledAnnualSavings = await this.cancelledSavingsInBase(
      cancelled,
      baseCurrency,
      now,
    );
    const reminderWindowDays = await this.reminderWindowDays(userId);

    return {
      baseCurrency,
      activeCount: active.length,
      monthlyCost: monthlyTotal.toFixed(2),
      annualCost: annualTotal.toFixed(2),
      byCurrency: [...monthlyBuckets.entries()]
        .map(([currency, monthly]) => ({
          currency,
          monthlyCost: monthly.toFixed(2),
          annualCost: (
            annualBuckets.get(currency) ?? new Prisma.Decimal(0)
          ).toFixed(2),
          activeCount: activeByCurrency.get(currency) ?? 0,
        }))
        .sort((left, right) => left.currency.localeCompare(right.currency)),
      previousMonthlyCost: previousMonthlyTotal.toFixed(2),
      realSpendThisMonth: realSpendThisMonth.toFixed(2),
      realSpendPreviousMonth: realSpendPreviousMonth.toFixed(2),
      trend: this.monthlyTrend(monthlyTotal, previousMonthlyTotal),
      pendingDetectedCount,
      cancelledAnnualSavings: cancelledAnnualSavings.toFixed(2),
      reminderWindowDays,
      upcoming: this.upcomingWithinWindow(active, now, reminderWindowDays),
    };
  }

  async breakdown(
    userId: string,
    by: SubscriptionBreakdown = 'category',
    now = new Date(),
  ) {
    const active = await this.repo.findActive(userId);
    const baseCurrency = await this.baseCurrency.execute(userId);
    const groups = new Map<
      string,
      {
        key: string;
        label: string;
        color: string | null;
        count: number;
        amount: Prisma.Decimal;
      }
    >();
    for (const row of active) {
      const descriptor = this.breakdownDescriptor(row, by);
      const monthly = monthlyCost({
        amount: toMoney(row.amount),
        cycle: row.billingCycle,
        interval: row.billingInterval,
      });
      const inBase = await this.resolveAmounts.toBaseCurrency(
        monthly,
        row.currency,
        baseCurrency,
        now,
      );
      const existing = groups.get(descriptor.key);
      groups.set(descriptor.key, {
        ...descriptor,
        count: (existing?.count ?? 0) + 1,
        amount: (existing?.amount ?? new Prisma.Decimal(0)).plus(inBase),
      });
    }
    return {
      baseCurrency,
      by,
      items: [...groups.values()]
        .sort((left, right) => right.amount.comparedTo(left.amount))
        .map((group) => ({
          key: group.key,
          label: group.label,
          color: group.color,
          count: group.count,
          amount: group.amount.toFixed(2),
        })),
    };
  }

  async upcoming(
    userId: string,
    query: UpcomingSubscriptionsQueryDto,
    now = new Date(),
  ) {
    const active = await this.repo.findActive(userId);
    const from = query.from ? dateOnly(new Date(query.from)) : dateOnly(now);
    const to = query.to
      ? dateOnly(new Date(query.to))
      : this.addDays(from, query.days ?? UPCOMING_DEFAULT_DAYS);
    const items = active.flatMap((row) =>
      billingOccurrencesInRange(
        {
          anchor: row.anchorDate,
          cycle: row.billingCycle,
          interval: row.billingInterval,
        },
        from,
        to,
      ).map((date) => ({
        id: `${row.id}:${isoDate(date)}`,
        subscriptionId: row.id,
        name: row.name,
        logoUrl: this.logos.resolveUrl(row),
        amount: row.amount.toFixed(2),
        currency: row.currency,
        date: isoDate(date),
        daysUntil: daysUntil(date, now),
        paymentMethod: this.paymentMethod(row),
      })),
    );
    items.sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        left.name.localeCompare(right.name),
    );
    return { from: isoDate(from), to: isoDate(to), items };
  }

  async alerts(userId: string, now = new Date()): Promise<SubscriptionAlert[]> {
    const active = await this.repo.findActive(userId);
    const payments = this.groupPaymentsBySubscription(
      await this.repo.listPaymentsForSubscriptions(active.map((row) => row.id)),
    );
    const dismissals = await this.repo.listAlertDismissals(userId);
    // The countdown alerts follow the global window, not the per-subscription
    // column kept in the database from the previous design.
    const reminderWindowDays = await this.reminderWindowDays(userId);
    const dismissed = new Set(
      dismissals.map(
        (row) => `${row.kind}:${row.subscriptionId}:${isoDate(row.alertDate)}`,
      ),
    );
    const alerts: SubscriptionAlert[] = [];
    for (const row of active) {
      const history = payments.get(row.id) ?? [];
      const derived = buildSubscriptionAlerts(
        {
          id: row.id,
          name: row.name,
          currency: row.currency,
          billingCycle: row.billingCycle,
          amount: scalarNumber(row.amount),
          nextBillingDate: row.nextBillingDate,
          trialEndsAt: row.trialEndsAt,
          reminderWindowDays,
          lastPaymentAmount: history[0]
            ? scalarNumber(history[0].amount)
            : null,
          lastPaymentDate: history[0]?.paidAt ?? null,
          previousPaymentAmount: history[1]
            ? scalarNumber(history[1].amount)
            : null,
          paidSinceNextBilling: history.some(
            (payment) => payment.paidAt >= row.nextBillingDate,
          ),
        },
        now,
      );
      for (const alert of derived) {
        if (dismissed.has(alert.id)) {
          continue;
        }
        alerts.push(alert);
      }
    }
    return alerts.sort((left, right) => left.date.localeCompare(right.date));
  }

  async dismissAllAlerts(userId: string, now = new Date()) {
    const alerts = await this.alerts(userId, now);
    await this.repo.dismissAlerts(
      alerts.map((alert) => ({
        userId,
        subscriptionId: alert.subscriptionId,
        kind: alert.kind,
        alertDate: dateOnly(new Date(alert.date)),
      })),
    );
    return { dismissed: alerts.length };
  }

  async dismissAlert(userId: string, dto: DismissSubscriptionAlertDto) {
    const subscription = await this.repo.findById(userId, dto.subscriptionId);
    if (!subscription) {
      throw new NotFoundException('Suscripción no encontrada');
    }
    const alertDate = dateOnly(new Date(dto.alertDate));
    await this.repo.dismissAlert({
      userId,
      subscriptionId: dto.subscriptionId,
      kind: dto.kind,
      alertDate,
    });
    return {
      id: `${dto.kind}:${dto.subscriptionId}:${isoDate(alertDate)}`,
      dismissed: true,
    };
  }

  async get(userId: string, id: string, now = new Date()) {
    const row = await this.repo.findById(userId, id);
    if (!row) {
      throw new NotFoundException('Suscripción no encontrada');
    }
    return this.map(row, now);
  }

  async create(userId: string, dto: CreateSubscriptionDto, now = new Date()) {
    await this.assertTargets(userId, dto.cardId, dto.accountId);
    if (dto.categoryId) {
      await this.ownership.assertCategoryVisible(userId, dto.categoryId);
    }
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
      amount: roundDecimal(dto.amount),
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
        dto.reminderDaysBefore ?? (await this.reminderWindowDays(userId)),
      cardId: dto.cardId ?? null,
      accountId: dto.accountId ?? null,
      categoryId: dto.categoryId ?? null,
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
      throw new NotFoundException('Suscripción no encontrada');
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
      changes.amount = roundDecimal(dto.amount);
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
    if (dto.categoryId !== undefined) {
      if (dto.categoryId) {
        await this.ownership.assertCategoryVisible(userId, dto.categoryId);
      }
      changes.categoryId = dto.categoryId ?? null;
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
      throw new NotFoundException('Suscripción no encontrada');
    }
    return this.map(updated, now);
  }

  async pause(userId: string, id: string, now = new Date()) {
    const changes: Prisma.FinSubscriptionUncheckedUpdateInput = {};
    this.applyStatus(changes, 'PAUSED', now);
    const updated = await this.repo.update(userId, id, changes);
    if (!updated) {
      throw new NotFoundException('Suscripción no encontrada');
    }
    return this.map(updated, now);
  }

  async resume(userId: string, id: string, now = new Date()) {
    const existing = await this.repo.findById(userId, id);
    if (!existing) {
      throw new NotFoundException('Suscripción no encontrada');
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
      throw new NotFoundException('Suscripción no encontrada');
    }
    return this.map(updated, now);
  }

  async cancel(userId: string, id: string, now = new Date()) {
    const changes: Prisma.FinSubscriptionUncheckedUpdateInput = {};
    this.applyStatus(changes, 'CANCELLED', now);
    const updated = await this.repo.update(userId, id, changes);
    if (!updated) {
      throw new NotFoundException('Suscripción no encontrada');
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
      throw new NotFoundException('Suscripción no encontrada');
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
      throw new NotFoundException('Suscripción no encontrada');
    }
    if (dto.transactionId) {
      const transaction = await this.repo.findTransaction(
        userId,
        dto.transactionId,
      );
      if (!transaction) {
        throw new BadRequestException('Transacción no encontrada');
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
      amount: roundDecimal(dto.amount ?? subscription.amount),
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
      throw new NotFoundException('Suscripción no encontrada');
    }
    const customLogoPath = await this.logos.saveCustomLogo(userId, id, file);
    const updated = await this.repo.update(userId, id, { customLogoPath });
    if (!updated) {
      throw new NotFoundException('Suscripción no encontrada');
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
          amount: scalarNumber(row.amount),
          currency: row.currency,
          nextBillingDate: row.nextBillingDate,
        },
        transaction: {
          merchant: transaction.merchant,
          amount: scalarNumber(transaction.amount),
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
      amount: roundDecimal(transaction.amount),
      currency: transaction.currency,
      paidAt: transaction.transactionDate,
      source: 'AUTO',
    });
    await this.advanceBilling(subscription);
  }

  private addToBucket(
    buckets: Map<string, Prisma.Decimal>,
    currency: string,
    amount: Prisma.Decimal,
  ): void {
    const current = buckets.get(currency) ?? new Prisma.Decimal(0);
    buckets.set(currency, current.plus(amount));
  }

  private async sumBucketsInBase(
    buckets: Map<string, Prisma.Decimal>,
    baseCurrency: string,
    asOf: Date,
  ): Promise<Prisma.Decimal> {
    let total = new Prisma.Decimal(0);
    for (const [currency, amount] of buckets) {
      const inBase = await this.resolveAmounts.toBaseCurrency(
        amount,
        currency,
        baseCurrency,
        asOf,
      );
      total = total.plus(inBase);
    }
    return total;
  }

  private groupPaymentsBySubscription(
    rows: SubscriptionPaymentRow[],
  ): Map<string, SubscriptionPaymentRow[]> {
    const grouped = new Map<string, SubscriptionPaymentRow[]>();
    for (const row of rows) {
      const list = grouped.get(row.subscriptionId) ?? [];
      list.push(row);
      grouped.set(row.subscriptionId, list);
    }
    return grouped;
  }

  private async sumPaymentsInBase(
    payments: { amount: Prisma.Decimal; currency: string; paidAt: Date }[],
    baseCurrency: string,
  ): Promise<Prisma.Decimal> {
    let total = new Prisma.Decimal(0);
    for (const payment of payments) {
      const inBase = await this.resolveAmounts.toBaseCurrency(
        payment.amount,
        payment.currency,
        baseCurrency,
        payment.paidAt,
      );
      total = total.plus(inBase);
    }
    return total;
  }

  private async cancelledSavingsInBase(
    rows: SubscriptionRow[],
    baseCurrency: string,
    asOf: Date,
  ): Promise<Prisma.Decimal> {
    let total = new Prisma.Decimal(0);
    for (const row of rows) {
      const annual = annualCost({
        amount: toMoney(row.amount),
        cycle: row.billingCycle,
        interval: row.billingInterval,
      });
      const inBase = await this.resolveAmounts.toBaseCurrency(
        annual,
        row.currency,
        baseCurrency,
        asOf,
      );
      total = total.plus(inBase);
    }
    return total;
  }

  private monthlyTrend(
    current: Prisma.Decimal,
    previous: Prisma.Decimal,
  ): { direction: 'up' | 'down' | 'flat'; percent: number } | null {
    if (previous.comparedTo(0) <= 0) {
      return null;
    }
    const percent =
      Math.round(ratioPercent(current.minus(previous), previous) * 10) / 10;
    if (percent === 0) {
      return { direction: 'flat', percent: 0 };
    }
    return { direction: percent > 0 ? 'up' : 'down', percent };
  }

  private breakdownDescriptor(
    row: SubscriptionRow,
    by: SubscriptionBreakdown,
  ): { key: string; label: string; color: string | null } {
    if (by === 'currency') {
      return { key: row.currency, label: row.currency, color: null };
    }
    if (by === 'instrument') {
      const method = this.paymentMethod(row);
      if (!method) {
        return {
          key: NO_INSTRUMENT_KEY,
          label: NO_INSTRUMENT_LABEL,
          color: null,
        };
      }
      return {
        key: `${method.type}:${method.id}`,
        label: method.name,
        color: row.card?.color ?? row.account?.color ?? null,
      };
    }
    if (!row.category) {
      return {
        key: UNCATEGORIZED_KEY,
        label: UNCATEGORIZED_LABEL,
        color: null,
      };
    }
    return {
      key: row.category.id,
      label: row.category.name,
      color: row.category.color,
    };
  }

  private paymentMethod(row: SubscriptionRow) {
    if (row.card) {
      return {
        type: 'CARD' as const,
        id: row.card.id,
        name: row.card.name,
        institution: row.card.institution?.name ?? null,
        last4: row.card.lastFour ?? null,
        logoUrl: this.logos.resolveUrl(row.card.institution),
      };
    }
    if (row.account) {
      return {
        type: 'ACCOUNT' as const,
        id: row.account.id,
        name: row.account.name,
        institution: row.account.institutionRef?.name ?? null,
        last4: row.account.accountNumberLast4 ?? null,
        logoUrl: this.logos.resolveUrl(row.account.institutionRef),
      };
    }
    return null;
  }

  private addDays(from: Date, days: number): Date {
    return new Date(from.getTime() + days * 86_400_000);
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
      throw new BadRequestException('Patrón recurrente no encontrado');
    }
  }

  private normalizedKeyFor(name: string): string {
    const key = normalizeMerchant(name);
    if (!key) {
      throw new BadRequestException(
        'El nombre de la suscripción es obligatorio',
      );
    }
    return key;
  }

  private async reminderWindowDays(userId: string): Promise<number> {
    const row = await this.usersRepository.findUserModuleBySlug(
      userId,
      FINANCE_MODULE_SLUG,
    );
    return resolveSubscriptionReminderDays(row?.config);
  }

  private upcomingWithinWindow(
    rows: SubscriptionRow[],
    now: Date,
    windowDays: number,
  ) {
    return rows
      .map((row) => ({ row, days: daysUntil(row.nextBillingDate, now) }))
      .filter((entry) => entry.days >= 0 && entry.days <= windowDays)
      .sort((left, right) => left.days - right.days)
      .map((entry) => ({
        ...this.map(entry.row, now),
        daysUntil: entry.days,
      }));
  }

  private map(row: SubscriptionRow, now: Date) {
    const amount = toMoney(row.amount);
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
      lastChargeMismatch: lastChargeMismatch({
        expectedAmount: scalarNumber(amount),
        lastPaymentAmount: row.payments[0]
          ? scalarNumber(row.payments[0].amount)
          : null,
      }),
      lastPaymentAmount: row.payments[0]
        ? row.payments[0].amount.toFixed(2)
        : null,
      lastRemindedFor: row.lastRemindedFor
        ? isoDate(row.lastRemindedFor)
        : null,
      cardId: row.cardId,
      cardName: row.card?.name ?? null,
      accountId: row.accountId,
      accountName: row.account?.name ?? null,
      categoryId: row.categoryId,
      category: row.category
        ? {
            id: row.category.id,
            name: row.category.name,
            icon: row.category.icon,
            color: row.category.color,
          }
        : null,
      paymentMethod: this.paymentMethod(row),
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
