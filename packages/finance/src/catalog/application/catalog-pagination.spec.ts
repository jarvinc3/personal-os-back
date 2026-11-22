import { CatalogCategoriesService } from './catalog-categories.service';
import { CatalogService } from './catalog.service';
import { CatalogAccountNumbersService } from './catalog-account-numbers.service';
import { CatalogAccountsService } from './catalog-accounts.service';
import { CatalogCardBalancesService } from './catalog-card-balances.service';
import { CatalogCardsService } from './catalog-cards.service';
import { CatalogEmailProductsService } from './catalog-email-products.service';
import { CatalogInstitutionsService } from './catalog-institutions.service';
import { CatalogViews } from './catalog-views';
import type { CatalogRepository } from '../infrastructure/catalog.repository';
import type { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import type { PurgeInstrumentLedgerUseCase } from '../../ledger/application/purge-instrument-ledger.use-case';
import type { EnsureCashInstitutionUseCase } from './ensure-cash-institution.use-case';
import type { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';

function createService(repo: CatalogRepository): CatalogService {
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
  const accounts = new CatalogAccountsService(
    repo,
    ownership,
    purge,
    {
      execute: jest.fn().mockResolvedValue(undefined),
    } as unknown as EnsureCashInstitutionUseCase,
    {
      execute: jest.fn().mockResolvedValue('DOP'),
    } as unknown as ResolveUserBaseCurrencyUseCase,
    numbers,
    views,
  );
  const cards = new CatalogCardsService(repo, ownership, purge, views);
  return new CatalogService(
    accounts,
    new CatalogInstitutionsService(repo, ownership, purge, undefined, views),
    cards,
    new CatalogCardBalancesService(repo),
    new CatalogEmailProductsService(repo, numbers, accounts, cards),
    new CatalogCategoriesService(repo, ownership),
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
    } as unknown as CatalogRepository;

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
    } as unknown as CatalogRepository;

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
    } as unknown as CatalogRepository;

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
