import { CatalogCategoriesService } from './catalog-categories.service';
import { CatalogService } from './catalog.service';
import { CatalogAccountNumbersService } from './catalog-account-numbers.service';
import { CatalogAccountLifecycle } from './catalog-account-lifecycle';
import { CatalogAccountMutations } from './catalog-account-mutations';
import { CatalogAccountReads } from './catalog-account-reads';
import { CatalogAccountRules } from './catalog-account-rules';
import { CatalogAccountsService } from './catalog-accounts.service';
import { CatalogCardLifecycle } from './catalog-card-lifecycle';
import { CatalogCardMutations } from './catalog-card-mutations';
import { CatalogCardReads } from './catalog-card-reads';
import { CatalogEmailProductLookup } from './catalog-email-product-lookup';
import { CatalogEmailProductWriter } from './catalog-email-product-writer';
import { CatalogEmailProposal } from './catalog-email-proposal';
import { CatalogInstitutionLedgerPurge } from './catalog-institution-ledger-purge';
import { CatalogInstitutionLifecycle } from './catalog-institution-lifecycle';
import { CatalogInstitutionMutations } from './catalog-institution-mutations';
import { CatalogInstitutionReads } from './catalog-institution-reads';
import { CatalogCardBalancesService } from './catalog-card-balances.service';
import { CatalogCardsService } from './catalog-cards.service';
import { CatalogEmailProductsService } from './catalog-email-products.service';
import { CatalogInstitutionsService } from './catalog-institutions.service';
import { CatalogViews } from './catalog-views';
import type { CatalogAccountRepository } from '../infrastructure/catalog-account.repository';
import type { CatalogCardBalanceRepository } from '../infrastructure/catalog-card-balance.repository';
import type { CatalogCardRepository } from '../infrastructure/catalog-card.repository';
import type { CatalogCategoryRepository } from '../infrastructure/catalog-category.repository';
import type { CatalogInstitutionRepository } from '../infrastructure/catalog-institution.repository';

type RepositoryMock = Record<string, jest.Mock>;
import type { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import type { PurgeInstrumentLedgerUseCase } from '../../ledger/application/purge-instrument-ledger.use-case';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';

function createService(repo: RepositoryMock): CatalogService {
  const accountsRepo = repo as unknown as CatalogAccountRepository;
  const cardsRepo = repo as unknown as CatalogCardRepository;
  const institutionsRepo = repo as unknown as CatalogInstitutionRepository;
  const ownership = {} as unknown as FinanceOwnershipService;
  const purge = {
    forAccount: jest.fn(),
    forCard: jest.fn(),
  } as unknown as PurgeInstrumentLedgerUseCase;
  const views = new CatalogViews();
  const numbers = new CatalogAccountNumbersService({
    get: jest
      .fn()
      .mockReturnValue('test-data-encryption-key-minimum-32-chars!!'),
  } as unknown as ConfigService<Env, true>);
  const rules = new CatalogAccountRules(repo as never, ownership, {
    execute: jest.fn().mockResolvedValue(undefined),
  } as never);
  const accounts = new CatalogAccountsService(
    new CatalogAccountReads(accountsRepo, rules, views),
    new CatalogAccountMutations(accountsRepo, rules, numbers),
    new CatalogAccountLifecycle(accountsRepo, purge, {
      execute: jest.fn().mockResolvedValue('DOP'),
    } as never),
  );
  const cards = new CatalogCardsService(
    new CatalogCardReads(cardsRepo, views),
    new CatalogCardMutations(cardsRepo, ownership),
    new CatalogCardLifecycle(cardsRepo, purge),
  );
  return new CatalogService(
    accounts,
    new CatalogInstitutionsService(
      new CatalogInstitutionReads(institutionsRepo, views),
      new CatalogInstitutionMutations(institutionsRepo, ownership, {
        saveCustomLogo: jest.fn(),
        ensureLogo: jest.fn(),
      } as never),
      new CatalogInstitutionLifecycle(
        institutionsRepo,
        ownership,
        new CatalogInstitutionLedgerPurge(accountsRepo, cardsRepo, purge),
      ),
    ),
    cards,
    new CatalogCardBalancesService(
      repo as unknown as CatalogCardBalanceRepository,
      cardsRepo,
    ),
    new CatalogEmailProductsService(
      new CatalogEmailProposal(numbers),
      new CatalogEmailProductLookup(institutionsRepo, accountsRepo, cardsRepo),
      new CatalogEmailProductWriter(accounts, cards),
    ),
    new CatalogCategoriesService(
      repo as unknown as CatalogCategoryRepository,
      ownership,
    ),
  );
}

function accountRow(index: number) {
  const id = `acc-${index}`;
  return {
    id,
    userId: 'user-1',
    institutionId: 'inst-1',
    institutionRef: null,
    name: `Cuenta ${String(index).padStart(2, '0')}`,
    type: 'CHECKING',
    currency: 'DOP',
    accountNumberLast4: '1234',
    isDefaultForInstitution: false,
    balance: 0,
    color: null,
    isActive: true,
    createdAt: new Date('2020-01-01T00:00:00Z'),
    updatedAt: new Date('2020-01-01T00:00:00Z'),
  };
}

function cardRow(index: number) {
  return {
    id: `card-${index}`,
    userId: 'user-1',
    institutionId: 'inst-1',
    accountId: null,
    name: `Tarjeta ${index}`,
    type: 'CREDIT',
    network: null,
    lastFour: '1234',
    statementClosingDay: null,
    paymentDueDay: null,
    color: null,
    isActive: true,
    createdAt: new Date(`2020-01-${String(index).padStart(2, '0')}T00:00:00Z`),
    institution: { name: 'Banco', logoPath: null, domain: null },
    account: null,
    balances: [],
    transactions: [],
  };
}

function institutionRow(index: number) {
  return {
    id: `inst-${index}`,
    userId: 'user-1',
    name: `Banco ${String(index).padStart(2, '0')}`,
    type: 'bank',
    shortName: null,
    sortOrder: 0,
    domain: null,
    color: null,
    country: 'DO',
    isActive: true,
    isSystem: false,
    logoPath: null,
  };
}

describe('CatalogService pagination', () => {
  it('pages accounts by name with a cursor and a hasMore flag', async () => {
    const rows = Array.from({ length: 21 }, (_, index) => accountRow(index));
    const repo = {
      findAccountsPage: jest.fn().mockResolvedValue(rows),
      sumEarmarkedByAccountIds: jest.fn().mockResolvedValue(new Map()),
    } as unknown as RepositoryMock;

    const page = await createService(repo).listAccountsPage('user-1', {
      limit: 20,
    });

    expect(page.items).toHaveLength(20);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).not.toBeNull();
  });

  it('pages cards newest first and stops at the last page', async () => {
    const repo = {
      listCardsPage: jest.fn().mockResolvedValue([cardRow(1), cardRow(2)]),
    } as unknown as RepositoryMock;

    const page = await createService(repo).listCardsPage('user-1', {
      limit: 20,
    });

    expect(page.items).toHaveLength(2);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('packs sortOrder and name into the institution cursor', async () => {
    const repo = {
      listInstitutions: jest
        .fn()
        .mockResolvedValue([
          institutionRow(1),
          { ...institutionRow(2), sortOrder: 3 },
          institutionRow(3),
        ]),
    } as unknown as RepositoryMock;

    const page = await createService(repo).listInstitutionsPage('user-1', {
      limit: 2,
    });

    expect(page.items).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    const decoded = JSON.parse(
      Buffer.from(page.nextCursor ?? '', 'base64url').toString('utf8'),
    );
    expect(decoded.key).toBe('3\u0000Banco 02');
  });
});
