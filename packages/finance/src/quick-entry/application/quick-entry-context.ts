import { Injectable } from '@nestjs/common';
import { UsersService } from '@personal-os/users';
import { CatalogService } from '../../catalog/application/catalog.service';
import { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import type {
  QuickEntryCatalogAccount,
  QuickEntryCatalogCard,
  QuickEntryCatalogCategory,
} from './ports/quick-entry-extractor.port';
import { todayIso } from './quick-entry-draft';
import type {
  CatalogAccount,
  CatalogCard,
  CatalogCategory,
} from './quick-entry-types';

export type QuickEntryContext = {
  accounts: CatalogAccount[];
  cards: CatalogCard[];
  categories: CatalogCategory[];
  baseCurrency: string;
  timezone: string | null;
  todayIso: string;
  catalogAccounts: QuickEntryCatalogAccount[];
  catalogCards: QuickEntryCatalogCard[];
  catalogCategories: QuickEntryCatalogCategory[];
};

/** Loads the user data that a quick entry needs to interpret the text. */
@Injectable()
export class QuickEntryContextService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly users: UsersService,
    private readonly baseCurrency: ResolveUserBaseCurrencyUseCase,
  ) {}

  async load(userId: string): Promise<QuickEntryContext> {
    const [accounts, cards, categories, baseCurrency, profile] =
      await Promise.all([
        this.catalog.listAccounts(userId),
        this.catalog.listCards(userId),
        this.catalog.listCategories(userId),
        this.baseCurrency.execute(userId),
        this.users.findById(userId),
      ]);

    return {
      accounts,
      cards,
      categories,
      baseCurrency,
      timezone: profile.timezone,
      todayIso: todayIso(profile.timezone, new Date()),
      catalogAccounts: accounts.map((account) => ({
        id: account.id,
        name: account.name,
        institutionName: account.institutionName,
        accountNumberLast4: account.accountNumberLast4,
        currency: account.currency,
      })),
      catalogCards: cards.map((card) => ({
        id: card.id,
        name: card.name,
        network: card.network,
        lastFour: card.lastFour,
        currency: card.balances[0]?.currency ?? null,
      })),
      catalogCategories: categories.map((category) => ({
        id: category.id,
        name: category.name,
        type: category.type,
      })),
    };
  }
}
