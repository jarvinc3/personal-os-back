import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { clampPageLimit, decodeCursor, toCursorPage } from '@personal-os/core';
import { ResolveAmountsUseCase } from '../../fx/application/resolve-amounts.use-case';
import { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import { roundMoney } from '../../shared/domain/money';
import { assertRestored } from '../../shared/application/assert-restored';
import {
  adjustmentSum,
  monthBounds,
  suggestAdjustments,
  type SuggestedAdjustment,
} from '../domain/reconciliation-adjustment';
import {
  ReconciliationsRepository,
  type ReconciliationRow,
  type ReconciliationTarget,
  type ResolvedAdjustmentInput,
} from '../infrastructure/reconciliations.repository';
import type { CreateReconciliationDto } from '../presentation/dto/create-reconciliation.dto';
import type { BankChargesGroupBy } from '../presentation/dto/bank-charges-query.dto';
import type { ListReconciliationsQueryDto } from '../presentation/dto/list-reconciliations-query.dto';
import type { PreviewReconciliationDto } from '../presentation/dto/preview-reconciliation.dto';

const DIFFERENCE_MISMATCH =
  'La suma de los ajustes no coincide con la diferencia';

function moneyString(value: number): string {
  return roundMoney(value).toFixed(2);
}

@Injectable()
export class ReconciliationsService {
  constructor(
    private readonly repo: ReconciliationsRepository,
    private readonly resolveAmounts: ResolveAmountsUseCase,
    private readonly baseCurrency: ResolveUserBaseCurrencyUseCase,
  ) {}

  async preview(userId: string, dto: PreviewReconciliationDto) {
    const target = await this.resolveTarget(userId, dto);
    const asOfDate = dto.asOfDate ?? todayIsoDate();
    const { from, to } = monthBounds(asOfDate.slice(0, 7));
    const outgoingTotal = await this.repo.sumOutgoing(userId, target, from, to);
    const appBalance = roundMoney(target.currentBalance);
    const realBalance = roundMoney(dto.realBalance);
    const difference = roundMoney(realBalance - appBalance);
    const suggestedAdjustments = suggestAdjustments({
      difference,
      outgoingTotal,
    });

    return {
      accountId: target.accountId,
      cardId: target.cardId,
      currency: target.currency,
      name: target.name,
      appBalance: moneyString(appBalance),
      realBalance: moneyString(realBalance),
      difference: moneyString(difference),
      suggestedAdjustments: suggestedAdjustments.map((adjustment) => ({
        kind: adjustment.kind,
        amount: moneyString(adjustment.amount),
      })),
    };
  }

  async create(userId: string, dto: CreateReconciliationDto) {
    const target = await this.resolveTarget(userId, dto);
    const asOfDate = dateOnly(dto.asOfDate ?? todayIsoDate());
    const appBalance = roundMoney(target.currentBalance);
    const realBalance = roundMoney(dto.realBalance);
    const difference = roundMoney(realBalance - appBalance);
    const requested =
      difference === 0
        ? []
        : (dto.adjustments ?? []).filter(
            (adjustment) => roundMoney(adjustment.amount) !== 0,
          );

    if (difference !== 0 && requested.length === 0) {
      throw new UnprocessableEntityException(DIFFERENCE_MISMATCH);
    }
    if (adjustmentSum(requested) !== difference) {
      throw new UnprocessableEntityException(DIFFERENCE_MISMATCH);
    }

    const resolved = await this.resolveAdjustments(
      userId,
      target,
      asOfDate,
      requested,
    );
    const row = await this.repo.create(userId, {
      target,
      asOfDate,
      appBalance,
      realBalance,
      difference,
      note: dto.note?.trim() ? dto.note.trim() : null,
      adjustments: resolved,
    });
    return this.mapRow(row);
  }

  async list(userId: string, query: ListReconciliationsQueryDto) {
    if (Boolean(query.accountId) === Boolean(query.cardId)) {
      throw new BadRequestException(
        'Provide exactly one of accountId or cardId',
      );
    }
    const limit = clampPageLimit(query.limit);
    const rows = await this.repo.list(userId, {
      accountId: query.accountId,
      cardId: query.cardId,
      cursor: query.cursor ? decodeCursor(query.cursor) : null,
      take: limit + 1,
    });
    const page = toCursorPage(rows, limit, (row) =>
      row.createdAt.toISOString(),
    );
    return { ...page, items: page.items.map((row) => this.mapRow(row)) };
  }

  async get(userId: string, id: string) {
    const row = await this.repo.findById(userId, id);
    if (!row) {
      throw new NotFoundException('Reconciliation not found');
    }
    return this.mapRow(row);
  }

  async remove(userId: string, id: string) {
    const outcome = await this.repo.delete(userId, id);
    if (outcome.notLatest) {
      throw new UnprocessableEntityException(
        'Solo se puede borrar la última conciliación del producto',
      );
    }
    if (outcome.count === 0) {
      throw new NotFoundException('Reconciliation not found');
    }
    return { success: true, undoId: id };
  }

  async restore(userId: string, id: string) {
    const restored = await this.repo.restore(userId, id, new Date());
    assertRestored(restored, 'Reconciliation not found');
    return { success: true };
  }

  async status(userId: string, month: string) {
    const { from, to } = monthBounds(month);
    const [products, reconciliations] = await Promise.all([
      this.repo.listProducts(userId),
      this.repo.listBetween(userId, from, to),
    ]);

    const latestByProduct = new Map<
      string,
      { id: string; reconciledAt: Date }
    >();
    for (const reconciliation of reconciliations) {
      const key = productKeyOf(reconciliation);
      if (!latestByProduct.has(key)) {
        latestByProduct.set(key, {
          id: reconciliation.id,
          reconciledAt: reconciliation.createdAt,
        });
      }
    }

    const items = products.map((product) => {
      const latest = latestByProduct.get(product.key) ?? null;
      return {
        ...product,
        balance: moneyString(product.balance),
        reconciled: Boolean(latest),
        lastReconciledAt: latest ? latest.reconciledAt.toISOString() : null,
      };
    });

    return {
      month,
      items,
      reconciledCount: items.filter((item) => item.reconciled).length,
      pendingCount: items.filter((item) => !item.reconciled).length,
    };
  }

  async bankCharges(
    userId: string,
    range: { from: Date; to: Date; groupBy?: BankChargesGroupBy },
  ) {
    const { from, to, groupBy } = range;
    const rows = await this.repo.listAdjustmentsBetween(userId, from, to);
    const byMonth = new Map<string, { total: number; count: number }>();
    const byInstitution = new Map<
      string,
      { name: string; total: number; count: number }
    >();
    const byKind = new Map<string, { total: number; count: number }>();
    let total = 0;

    for (const row of rows) {
      const amount = Number(row.amount);
      total += amount;

      const month = row.reconciliation.asOfDate.toISOString().slice(0, 7);
      const monthEntry = byMonth.get(month) ?? { total: 0, count: 0 };
      monthEntry.total += amount;
      monthEntry.count += 1;
      byMonth.set(month, monthEntry);

      const account = row.reconciliation.account;
      const card = row.reconciliation.card;
      const institutionName =
        account?.institutionRef?.name ?? card?.institution?.name ?? null;
      const institutionKey = account
        ? `account-institution:${account.institutionId ?? 'none'}`
        : `card-institution:${card?.institutionId ?? 'none'}`;
      const institutionEntry = byInstitution.get(institutionKey) ?? {
        name: institutionName ?? 'Sin banco',
        total: 0,
        count: 0,
      };
      institutionEntry.total += amount;
      institutionEntry.count += 1;
      byInstitution.set(institutionKey, institutionEntry);

      const kindEntry = byKind.get(row.kind) ?? { total: 0, count: 0 };
      kindEntry.total += amount;
      kindEntry.count += 1;
      byKind.set(row.kind, kindEntry);
    }

    const byMonthRows = [...byMonth.entries()]
      .map(([month, entry]) => ({
        month,
        total: moneyString(entry.total),
        count: entry.count,
      }))
      .sort((left, right) => left.month.localeCompare(right.month));
    const byInstitutionRows = [...byInstitution.entries()]
      .map(([, entry]) => ({
        name: entry.name,
        total: moneyString(entry.total),
        count: entry.count,
      }))
      .sort((left, right) => Number(left.total) - Number(right.total));
    const byKindRows = [...byKind.entries()]
      .map(([kind, entry]) => ({
        kind,
        total: moneyString(entry.total),
        count: entry.count,
      }))
      .sort((left, right) => Number(left.total) - Number(right.total));

    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      total: moneyString(total),
      count: rows.length,
      byMonth: groupBy === undefined || groupBy === 'month' ? byMonthRows : [],
      byInstitution:
        groupBy === undefined || groupBy === 'institution'
          ? byInstitutionRows
          : [],
      byKind: groupBy === undefined || groupBy === 'kind' ? byKindRows : [],
    };
  }

  private async resolveTarget(
    userId: string,
    dto: PreviewReconciliationDto,
  ): Promise<ReconciliationTarget> {
    if (Boolean(dto.accountId) === Boolean(dto.cardId)) {
      throw new BadRequestException(
        'Provide exactly one of accountId or cardId',
      );
    }
    const target = await this.repo.findTarget(userId, {
      accountId: dto.accountId,
      cardId: dto.cardId,
      currency: dto.currency,
    });
    if (!target) {
      throw new NotFoundException('Account or card not found');
    }
    return target;
  }

  private async resolveAdjustments(
    userId: string,
    target: ReconciliationTarget,
    asOfDate: Date,
    adjustments: readonly {
      kind: SuggestedAdjustment['kind'];
      amount: number;
    }[],
  ) {
    const baseCurrency = await this.baseCurrency.execute(userId);
    const resolved: ResolvedAdjustmentInput[] = [];
    for (const adjustment of adjustments) {
      const signed = roundMoney(adjustment.amount);
      const amounts = await this.resolveAmounts.execute({
        amount: Math.abs(signed),
        currency: target.currency,
        ledgerCurrency: target.currency,
        baseCurrency,
        transactionDate: asOfDate,
      });
      resolved.push({
        kind: adjustment.kind,
        amounts: { ...amounts, ledgerAmount: signed },
      });
    }
    return resolved;
  }

  private mapRow(row: ReconciliationRow) {
    return {
      id: row.id,
      accountId: row.accountId,
      cardId: row.cardId,
      currency: row.currency,
      asOfDate: row.asOfDate.toISOString().slice(0, 10),
      appBalance: moneyString(Number(row.appBalance)),
      realBalance: moneyString(Number(row.realBalance)),
      difference: moneyString(Number(row.difference)),
      note: row.note,
      createdAt: row.createdAt.toISOString(),
      adjustments: row.adjustments.map((adjustment) => ({
        id: adjustment.id,
        kind: adjustment.kind,
        amount: moneyString(Number(adjustment.amount)),
        transactionId: adjustment.transactionId,
      })),
    };
  }
}

function dateOnly(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

/** Today as an ISO date, used when the close comes without a cut-off date. */
function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function productKeyOf(reconciliation: {
  accountId: string | null;
  cardId: string | null;
  currency: string;
}): string {
  return reconciliation.accountId
    ? `account:${reconciliation.accountId}`
    : `card:${reconciliation.cardId}:${reconciliation.currency}`;
}
