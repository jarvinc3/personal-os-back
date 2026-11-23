import { Injectable } from '@nestjs/common';
import { FinanceEntityLookupService } from '../../entities/application/finance-entity-lookup.service';
import {
  entityRefKey,
  type FinanceEntityRef,
} from '../../entities/domain/entity-reference';
import { ResolveAmountsUseCase } from '../../fx/application/resolve-amounts.use-case';
import { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import {
  currencySlices,
  entityTypeForLineKind,
  groupBalanceSheetLines,
  type BalanceSheetLine,
} from '../domain/balance-sheet-breakdown';
import { BalanceSheetRepository } from '../infrastructure/balance-sheet.repository';
import { addAccountLines } from './balance-sheet-account-lines';
import { BalanceSheetBuckets } from './balance-sheet-buckets';
import { addCardLines } from './balance-sheet-card-lines';
import { BalanceSheetCash } from './balance-sheet-cash';
import { loadBalanceSheetContext } from './balance-sheet-context';
import { buildBalanceSheetIndexes } from './balance-sheet-indexes';
import { addLoanLines } from './balance-sheet-loan-lines';
import { addReceivableLines } from './balance-sheet-receivable-lines';
import { BalanceSheetRates } from './balance-sheet-rates';
import type {
  BalanceSheetLineDraft,
  FinanceBalanceSheet,
} from './balance-sheet-types';

export type {
  BalanceSheetIssue,
  BalanceSheetSlice,
  BalanceSheetStatus,
  CashAccountLine,
  CashCurrencyBreakdown,
  FinanceBalanceSheet,
  FinanceCashSummary,
} from './balance-sheet-types';

function groupLinesByInstitution(
  lines: readonly BalanceSheetLine[],
): Map<string, BalanceSheetLine[]> {
  const linesByInstitution = new Map<string, BalanceSheetLine[]>();
  for (const line of lines) {
    if (!line.institutionId) {
      continue;
    }
    const group = linesByInstitution.get(line.institutionId) ?? [];
    group.push(line);
    linesByInstitution.set(line.institutionId, group);
  }
  return linesByInstitution;
}

@Injectable()
export class BalanceSheetService {
  private readonly cash: BalanceSheetCash;

  constructor(
    private readonly repo: BalanceSheetRepository,
    private readonly resolveAmounts: ResolveAmountsUseCase,
    private readonly baseCurrency: ResolveUserBaseCurrencyUseCase,
    private readonly entities: FinanceEntityLookupService,
  ) {
    this.cash = new BalanceSheetCash(this.repo);
  }

  async getBalanceSheet(userId: string): Promise<FinanceBalanceSheet> {
    const context = await loadBalanceSheetContext({
      userId,
      repo: this.repo,
      baseCurrency: this.baseCurrency,
    });
    const indexes = buildBalanceSheetIndexes({
      reconciliations: context.reconciliations,
      drifts: context.drifts,
    });
    const buckets = new BalanceSheetBuckets(
      context.positions.institutions.map((institution) => institution.id),
    );
    const rates = new BalanceSheetRates(this.resolveAmounts);
    const lineInput = {
      baseCurrency: context.baseCurrency,
      asOf: context.asOf,
      rates,
      indexes,
      buckets,
    };
    const lines = [
      ...(await addAccountLines({
        ...lineInput,
        accounts: context.positions.accounts,
      })),
      ...(await addCardLines({
        ...lineInput,
        cardBalances: context.positions.cardBalances,
      })),
      ...(await addLoanLines({
        ...lineInput,
        loans: context.positions.loans,
      })),
      ...(await addReceivableLines({
        ...lineInput,
        receivables: context.receivables,
        timezone: context.timezone,
      })),
    ];
    const linesWithEntities = await this.withEntities(userId, lines);
    const breakdown = groupBalanceSheetLines(
      linesWithEntities,
      context.baseCurrency,
    );
    const linesByInstitution = groupLinesByInstitution(linesWithEntities);

    return {
      asOf: context.asOf.toISOString(),
      rateDate: context.rateDate,
      baseCurrency: context.baseCurrency,
      global: buckets.globalSlice(currencySlices(breakdown.byCurrency)),
      institutions: context.positions.institutions.map((institution) => {
        const institutionBreakdown = groupBalanceSheetLines(
          linesByInstitution.get(institution.id) ?? [],
          context.baseCurrency,
        );
        return {
          institutionId: institution.id,
          ...buckets.institutionSlice(
            institution.id,
            currencySlices(institutionBreakdown.byCurrency),
          ),
        };
      }),
      cash: await this.cash.summary({
        userId,
        baseCurrency: context.baseCurrency,
        asOf: context.asOf,
        rates,
      }),
      breakdown,
    };
  }

  private async withEntities(
    userId: string,
    lines: readonly BalanceSheetLineDraft[],
  ): Promise<BalanceSheetLine[]> {
    const entityRefs = lines.map((line): FinanceEntityRef => ({
      type: entityTypeForLineKind(line.kind),
      id: line.id,
    }));
    const entities =
      entityRefs.length > 0
        ? await this.entities.lookupByKey(userId, entityRefs)
        : new Map<string, unknown>();
    return lines.map((line, index) => ({
      ...line,
      entity: entities.get(entityRefKey(entityRefs[index])) ?? null,
    }));
  }
}
