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
import { emptyAccumulation, serializeSlice } from './balance-sheet-buckets';
import { buildCashSummary } from './balance-sheet-cash';
import {
  addAccountLines,
  addCardLines,
  addLoanLines,
  institutionBucket,
} from './balance-sheet-lines';
import { addReceivableLines } from './balance-sheet-receivables';
import { loadBalanceSheetSnapshot } from './balance-sheet-snapshot';
import type { FinanceBalanceSheet } from './balance-sheet-types';

export type {
  BalanceSheetIssue,
  BalanceSheetSlice,
  BalanceSheetStatus,
  CashAccountLine,
  CashCurrencyBreakdown,
  FinanceBalanceSheet,
  FinanceCashSummary,
} from './balance-sheet-types';

@Injectable()
export class BalanceSheetService {
  constructor(
    private readonly repo: BalanceSheetRepository,
    private readonly resolveAmounts: ResolveAmountsUseCase,
    private readonly baseCurrency: ResolveUserBaseCurrencyUseCase,
    private readonly entities: FinanceEntityLookupService,
  ) {}

  async getBalanceSheet(userId: string): Promise<FinanceBalanceSheet> {
    const snapshot = await loadBalanceSheetSnapshot({
      repo: this.repo,
      baseCurrency: this.baseCurrency,
      resolveAmounts: this.resolveAmounts,
      userId,
    });
    const accumulation = emptyAccumulation(
      snapshot.positions.institutions.map((institution) => institution.id),
    );
    const lines: Array<Omit<BalanceSheetLine, 'entity'>> = [];
    await addAccountLines({ snapshot, accumulation, lines });
    await addCardLines({ snapshot, accumulation, lines });
    await addLoanLines({ snapshot, accumulation, lines });
    await addReceivableLines({ snapshot, accumulation, lines });

    const linesWithEntities = await this.attachEntities(userId, lines);
    const breakdown = groupBalanceSheetLines(
      linesWithEntities,
      snapshot.baseCurrency,
    );
    const linesByInstitution = this.groupByInstitution(linesWithEntities);

    return {
      asOf: snapshot.asOf.toISOString(),
      rateDate: snapshot.rateDate,
      baseCurrency: snapshot.baseCurrency,
      global: serializeSlice(
        accumulation.global,
        currencySlices(breakdown.byCurrency),
      ),
      institutions: snapshot.positions.institutions.map((institution) => {
        const institutionBreakdown = groupBalanceSheetLines(
          linesByInstitution.get(institution.id) ?? [],
          snapshot.baseCurrency,
        );
        return {
          institutionId: institution.id,
          ...serializeSlice(
            institutionBucket(accumulation, institution.id),
            currencySlices(institutionBreakdown.byCurrency),
          ),
        };
      }),
      cash: await buildCashSummary({
        repo: this.repo,
        resolveAmounts: this.resolveAmounts,
        userId,
        baseCurrency: snapshot.baseCurrency,
        asOf: snapshot.asOf,
        rateCache: snapshot.rateCache,
      }),
      breakdown,
    };
  }

  private async attachEntities(
    userId: string,
    lines: ReadonlyArray<Omit<BalanceSheetLine, 'entity'>>,
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

  private groupByInstitution(
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
}
