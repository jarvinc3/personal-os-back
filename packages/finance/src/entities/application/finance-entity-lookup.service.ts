import { Injectable } from '@nestjs/common';
import { CatalogCategoriesService } from '../../catalog/application/catalog-categories.service';
import { CatalogService } from '../../catalog/application/catalog.service';
import { LedgerQueryService } from '../../ledger/application/ledger-query.service';
import { MerchantsService } from '../../merchants/application/merchants.service';
import { PlanningService } from '../../planning/application/planning.service';
import { SubscriptionsService } from '../../subscriptions/application/subscriptions.service';
import {
  FINANCE_ENTITY_TYPE,
  entityRefKey,
  type FinanceEntityRef,
  type FinanceEntityType,
} from '../domain/entity-reference';

type LoadedEntities = ReadonlyMap<string, unknown>;

/**
 * Resolves references to the same public representation each entity endpoint
 * returns, one query per type. A reference the user cannot see is absent, so the
 * caller returns null for that position without failing the call.
 */
@Injectable()
export class FinanceEntityLookupService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly categories: CatalogCategoriesService,
    private readonly ledger: LedgerQueryService,
    private readonly planning: PlanningService,
    private readonly subscriptions: SubscriptionsService,
    private readonly merchants: MerchantsService,
  ) {}

  /** Entities in the same order as the references; null when not available. */
  async lookup(
    userId: string,
    refs: readonly FinanceEntityRef[],
  ): Promise<Array<unknown>> {
    const byKey = await this.lookupByKey(userId, refs);
    return refs.map((ref) => byKey.get(entityRefKey(ref)) ?? null);
  }

  /** Same work as `lookup`, keyed by `type:id` for callers that need a map. */
  async lookupByKey(
    userId: string,
    refs: readonly FinanceEntityRef[],
  ): Promise<Map<string, unknown>> {
    const idsByType = new Map<FinanceEntityType, string[]>();
    for (const ref of refs) {
      const ids = idsByType.get(ref.type) ?? [];
      ids.push(ref.id);
      idsByType.set(ref.type, ids);
    }

    const loadedByType = await Promise.all(
      [...idsByType.entries()].map(
        async ([type, ids]) =>
          [type, await this.loadType(userId, type, ids)] as const,
      ),
    );

    const byKey = new Map<string, unknown>();
    for (const [type, entities] of loadedByType) {
      for (const [id, entity] of entities) {
        byKey.set(entityRefKey({ type, id }), entity);
      }
    }
    return byKey;
  }

  private loadType(
    userId: string,
    type: FinanceEntityType,
    ids: string[],
  ): Promise<LoadedEntities> {
    switch (type) {
      case FINANCE_ENTITY_TYPE.TRANSACTION:
        return this.ledger.lookupTransactions(userId, ids);
      case FINANCE_ENTITY_TYPE.ACCOUNT:
        return this.catalog.lookupAccounts(userId, ids);
      case FINANCE_ENTITY_TYPE.CARD:
        return this.catalog.lookupCards(userId, ids);
      case FINANCE_ENTITY_TYPE.LOAN:
        return this.planning.lookupLoans(userId, ids);
      case FINANCE_ENTITY_TYPE.BUDGET:
        return this.planning.lookupBudgets(userId, ids);
      case FINANCE_ENTITY_TYPE.SAVINGS_GOAL:
        return this.planning.lookupSavingsGoals(userId, ids);
      case FINANCE_ENTITY_TYPE.RECEIVABLE:
        return this.planning.lookupReceivables(userId, ids);
      case FINANCE_ENTITY_TYPE.SUBSCRIPTION:
        return this.subscriptions.lookupSubscriptions(userId, ids);
      case FINANCE_ENTITY_TYPE.MERCHANT:
        return this.merchants.lookupMerchants(userId, ids);
      case FINANCE_ENTITY_TYPE.CATEGORY:
        return this.categories.lookupCategories(userId, ids);
    }
  }
}
