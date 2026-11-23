import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { clampPageLimit, decodeCursor, toCursorPage } from '@personal-os/core';
import { PrismaService } from '@personal-os/database';
import { LogoService, type LogoUploadFile } from '@personal-os/logos';
import { USERS_REPOSITORY, type UsersRepositoryPort } from '@personal-os/users';
import { ResolveAmountsUseCase } from '../../fx/application/resolve-amounts.use-case';
import { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import type { SubscriptionMatcherPort } from '../../shared/application/subscription-matcher.port';
import {
  DEFAULT_SUBSCRIPTION_SORT,
  isValidSubscriptionCursorKey,
  subscriptionCursorKey,
} from '../domain/subscription-list';
import { SubscriptionsRepository } from '../infrastructure/subscriptions.repository';
import type { CreateSubscriptionDto } from '../presentation/dto/create-subscription.dto';
import type { CreateSubscriptionPaymentDto } from '../presentation/dto/create-subscription-payment.dto';
import type { DismissSubscriptionAlertDto } from '../presentation/dto/dismiss-subscription-alert.dto';
import type { ListSubscriptionsQueryDto } from '../presentation/dto/list-subscriptions-query.dto';
import type { SubscriptionBreakdown } from '../presentation/dto/subscription-breakdown-query.dto';
import type { UpcomingSubscriptionsQueryDto } from '../presentation/dto/upcoming-subscriptions-query.dto';
import type { UpdateSubscriptionDto } from '../presentation/dto/update-subscription.dto';
import { SubscriptionAlertFeed } from './subscription-alert-feed';
import { SubscriptionChanges } from './subscription-changes';
import { SubscriptionCosts } from './subscription-costs';
import { SubscriptionInsights } from './subscription-insights';
import { SubscriptionPayments } from './subscription-payments';
import { SubscriptionReminderWindow } from './subscription-reminder-window';
import { SubscriptionView } from './subscription-view';

@Injectable()
export class SubscriptionsService implements SubscriptionMatcherPort {
  private readonly view: SubscriptionView;
  private readonly reminderWindow: SubscriptionReminderWindow;
  private readonly changes: SubscriptionChanges;
  private readonly costs: SubscriptionCosts;
  private readonly insights: SubscriptionInsights;
  private readonly alertFeed: SubscriptionAlertFeed;
  private readonly payments: SubscriptionPayments;

  constructor(
    private readonly repo: SubscriptionsRepository,
    private readonly prisma: PrismaService,
    private readonly logos: LogoService,
    private readonly ownership: FinanceOwnershipService,
    private readonly baseCurrency: ResolveUserBaseCurrencyUseCase,
    private readonly resolveAmounts: ResolveAmountsUseCase,
    @Inject(USERS_REPOSITORY)
    private readonly usersRepository: UsersRepositoryPort,
  ) {
    this.view = new SubscriptionView(logos);
    this.reminderWindow = new SubscriptionReminderWindow(usersRepository);
    this.changes = new SubscriptionChanges(
      logos,
      baseCurrency,
      this.reminderWindow,
    );
    this.costs = new SubscriptionCosts(resolveAmounts);
    this.insights = new SubscriptionInsights({
      repo,
      view: this.view,
      baseCurrency,
      costs: this.costs,
      reminderWindow: this.reminderWindow,
    });
    this.alertFeed = new SubscriptionAlertFeed({
      repo,
      reminderWindow: this.reminderWindow,
    });
    this.payments = new SubscriptionPayments(repo);
  }

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
      items: page.items.map((row) => this.view.map(row, now)),
    };
  }

  summary(userId: string, now = new Date()) {
    return this.insights.summary(userId, now);
  }

  breakdown(
    userId: string,
    by: SubscriptionBreakdown = 'category',
    now = new Date(),
  ) {
    return this.insights.breakdown(userId, by, now);
  }

  upcoming(
    userId: string,
    query: UpcomingSubscriptionsQueryDto,
    now = new Date(),
  ) {
    return this.insights.upcoming(userId, query, now);
  }

  alerts(userId: string, now = new Date()) {
    return this.alertFeed.alerts(userId, now);
  }

  dismissAllAlerts(userId: string, now = new Date()) {
    return this.alertFeed.dismissAllAlerts(userId, now);
  }

  dismissAlert(userId: string, dto: DismissSubscriptionAlertDto) {
    return this.alertFeed.dismissAlert(userId, dto);
  }

  async get(userId: string, id: string, now = new Date()) {
    const row = await this.repo.findById(userId, id);
    if (!row) {
      throw new NotFoundException('Suscripción no encontrada');
    }
    return this.view.map(row, now);
  }

  /** Subscriptions with the same shape as `get`, in batch and without throwing. */
  async lookupSubscriptions(
    userId: string,
    ids: readonly string[],
    now = new Date(),
  ) {
    const rows = await this.repo.findByIds(userId, ids);
    return new Map(rows.map((row) => [row.id, this.view.map(row, now)]));
  }

  async create(userId: string, dto: CreateSubscriptionDto, now = new Date()) {
    await this.assertTargets(userId, dto.cardId, dto.accountId);
    if (dto.categoryId) {
      await this.ownership.assertCategoryVisible(userId, dto.categoryId);
    }
    if (dto.sourcePatternId) {
      await this.assertPatternOwned(userId, dto.sourcePatternId);
    }
    const created = await this.repo.create(
      userId,
      await this.changes.forCreate(userId, dto, now),
    );
    return this.view.map(created, now);
  }

  // Public signature kept for the controller, the facade and the tests; the
  // orchestrator behind it takes one object.
  // eslint-disable-next-line max-params
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
    if (dto.categoryId) {
      await this.ownership.assertCategoryVisible(userId, dto.categoryId);
    }
    const updated = await this.repo.update(
      userId,
      id,
      await this.changes.forUpdate(existing, dto, now),
    );
    if (!updated) {
      throw new NotFoundException('Suscripción no encontrada');
    }
    return this.view.map(updated, now);
  }

  async pause(userId: string, id: string, now = new Date()) {
    const updated = await this.repo.update(
      userId,
      id,
      this.changes.forStatus('PAUSED', now),
    );
    if (!updated) {
      throw new NotFoundException('Suscripción no encontrada');
    }
    return this.view.map(updated, now);
  }

  async resume(userId: string, id: string, now = new Date()) {
    const existing = await this.repo.findById(userId, id);
    if (!existing) {
      throw new NotFoundException('Suscripción no encontrada');
    }
    const updated = await this.repo.update(
      userId,
      id,
      this.changes.forResume(existing, now),
    );
    if (!updated) {
      throw new NotFoundException('Suscripción no encontrada');
    }
    return this.view.map(updated, now);
  }

  async cancel(userId: string, id: string, now = new Date()) {
    const updated = await this.repo.update(
      userId,
      id,
      this.changes.forStatus('CANCELLED', now),
    );
    if (!updated) {
      throw new NotFoundException('Suscripción no encontrada');
    }
    return this.view.map(updated, now);
  }

  listPayments(
    userId: string,
    id: string,
    query: { limit?: number; cursor?: string },
  ) {
    return this.payments.list(userId, id, query);
  }

  // eslint-disable-next-line max-params
  recordManualPayment(
    userId: string,
    id: string,
    dto: CreateSubscriptionPaymentDto,
    now = new Date(),
  ) {
    return this.payments.recordManualPayment({ userId, id, dto, now });
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

  matchTransaction(input: {
    userId: string;
    transactionId: string;
  }): Promise<void> {
    return this.payments.matchTransaction(input);
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
}
