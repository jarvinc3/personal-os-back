import type { CatalogCategoriesService } from '../../catalog/application/catalog-categories.service';
import type { CatalogService } from '../../catalog/application/catalog.service';
import type { LedgerQueryService } from '../../ledger/application/ledger-query.service';
import type { MerchantsService } from '../../merchants/application/merchants.service';
import type { PlanningService } from '../../planning/application/planning.service';
import type { SubscriptionsService } from '../../subscriptions/application/subscriptions.service';
import { FinanceEntityLookupService } from './finance-entity-lookup.service';

describe('FinanceEntityLookupService', () => {
  const lookupTransactions = jest.fn();
  const lookupAccounts = jest.fn();
  const lookupCards = jest.fn();
  const lookupLoans = jest.fn();
  const lookupBudgets = jest.fn();
  const lookupSavingsGoals = jest.fn();
  const lookupReceivables = jest.fn();
  const lookupSubscriptions = jest.fn();
  const lookupMerchants = jest.fn();
  const lookupCategories = jest.fn();
  const lookupInstitutions = jest.fn();

  const createService = () =>
    new FinanceEntityLookupService(
      {
        lookupAccounts,
        lookupCards,
        lookupInstitutions,
      } as unknown as CatalogService,
      { lookupCategories } as unknown as CatalogCategoriesService,
      { lookupTransactions } as unknown as LedgerQueryService,
      {
        lookupLoans,
        lookupBudgets,
        lookupSavingsGoals,
        lookupReceivables,
      } as unknown as PlanningService,
      { lookupSubscriptions } as unknown as SubscriptionsService,
      { lookupMerchants } as unknown as MerchantsService,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    lookupTransactions.mockResolvedValue(new Map());
    lookupAccounts.mockResolvedValue(new Map());
    lookupCards.mockResolvedValue(new Map());
    lookupLoans.mockResolvedValue(new Map());
    lookupBudgets.mockResolvedValue(new Map());
    lookupSavingsGoals.mockResolvedValue(new Map());
    lookupReceivables.mockResolvedValue(new Map());
    lookupSubscriptions.mockResolvedValue(new Map());
    lookupMerchants.mockResolvedValue(new Map());
    lookupCategories.mockResolvedValue(new Map());
    lookupInstitutions.mockResolvedValue(new Map());
  });

  it('returns each entity in the same order as the references', async () => {
    lookupTransactions.mockResolvedValue(new Map([['tx-1', { id: 'tx-1' }]]));
    lookupLoans.mockResolvedValue(new Map([['loan-1', { id: 'loan-1' }]]));

    const entities = await createService().lookup('user-1', [
      { type: 'loan', id: 'loan-1' },
      { type: 'transaction', id: 'tx-1' },
    ]);

    expect(entities).toEqual([{ id: 'loan-1' }, { id: 'tx-1' }]);
  });

  it('leaves a missing entity as null without failing the call', async () => {
    lookupTransactions.mockResolvedValue(new Map([['tx-1', { id: 'tx-1' }]]));

    const entities = await createService().lookup('user-1', [
      { type: 'transaction', id: 'tx-1' },
      { type: 'transaction', id: 'tx-gone' },
    ]);

    expect(entities).toEqual([{ id: 'tx-1' }, null]);
  });

  it('queries each type once for all its references', async () => {
    await createService().lookup('user-1', [
      { type: 'transaction', id: 'tx-1' },
      { type: 'transaction', id: 'tx-2' },
      { type: 'transaction', id: 'tx-3' },
      { type: 'budget', id: 'budget-1' },
    ]);

    expect(lookupTransactions).toHaveBeenCalledTimes(1);
    expect(lookupTransactions).toHaveBeenCalledWith('user-1', [
      'tx-1',
      'tx-2',
      'tx-3',
    ]);
    expect(lookupBudgets).toHaveBeenCalledTimes(1);
    expect(lookupBudgets).toHaveBeenCalledWith('user-1', ['budget-1']);
  });

  it('dispatches every supported type to its own loader', async () => {
    await createService().lookup('user-1', [
      { type: 'transaction', id: 'a' },
      { type: 'account', id: 'b' },
      { type: 'card', id: 'c' },
      { type: 'loan', id: 'd' },
      { type: 'budget', id: 'e' },
      { type: 'savingsGoal', id: 'f' },
      { type: 'receivable', id: 'g' },
      { type: 'subscription', id: 'h' },
      { type: 'merchant', id: 'i' },
      { type: 'category', id: 'j' },
      { type: 'institution', id: 'k' },
    ]);

    for (const loader of [
      lookupTransactions,
      lookupAccounts,
      lookupCards,
      lookupLoans,
      lookupBudgets,
      lookupSavingsGoals,
      lookupReceivables,
      lookupSubscriptions,
      lookupMerchants,
      lookupCategories,
      lookupInstitutions,
    ]) {
      expect(loader).toHaveBeenCalledTimes(1);
    }
  });

  it('resuelve la institución como una entidad más', async () => {
    lookupInstitutions.mockResolvedValue(
      new Map([['inst-1', { id: 'inst-1', name: 'Banco' }]]),
    );

    const entities = await createService().lookup('user-1', [
      { type: 'institution', id: 'inst-1' },
    ]);

    expect(lookupInstitutions).toHaveBeenCalledWith('user-1', ['inst-1']);
    expect(entities).toEqual([{ id: 'inst-1', name: 'Banco' }]);
  });

  it('keys the batch by type and id so two types never collide', async () => {
    lookupAccounts.mockResolvedValue(new Map([['same-id', { id: 'account' }]]));
    lookupCards.mockResolvedValue(new Map([['same-id', { id: 'card' }]]));

    const byKey = await createService().lookupByKey('user-1', [
      { type: 'account', id: 'same-id' },
      { type: 'card', id: 'same-id' },
    ]);

    expect(byKey.get('account:same-id')).toEqual({ id: 'account' });
    expect(byKey.get('card:same-id')).toEqual({ id: 'card' });
  });
});
