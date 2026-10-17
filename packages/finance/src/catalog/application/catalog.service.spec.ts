import { CatalogService } from './catalog.service';
import type { CatalogRepository } from '../infrastructure/catalog.repository';
import type { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import type { PurgeInstrumentLedgerUseCase } from '../../ledger/application/purge-instrument-ledger.use-case';
import type { EnsureCashInstitutionUseCase } from './ensure-cash-institution.use-case';
import type { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';

const TEST_DATA_ENCRYPTION_KEY = 'test-data-encryption-key-minimum-32-chars!!';
const BASE64_CIPHERTEXT = /^[A-Za-z0-9+/]+=*$/;

function configMock(): ConfigService<Env, true> {
  return {
    get: jest.fn().mockReturnValue(TEST_DATA_ENCRYPTION_KEY),
  } as unknown as ConfigService<Env, true>;
}

function ownershipMock(
  overrides: Partial<Record<keyof FinanceOwnershipService, jest.Mock>> = {},
): FinanceOwnershipService {
  return {
    assertInstitutionOwned: jest.fn((_userId: string, id: string) => {
      if (id === 'inst-1') {
        return Promise.resolve({ id, name: 'Banco' });
      }
      return Promise.reject(
        new BadRequestException('Institución no encontrada'),
      );
    }),
    assertInstitutionAcceptsBankProducts: jest.fn(
      (_userId: string, id: string) => {
        if (id === 'inst-1') {
          return Promise.resolve({ id, name: 'Banco', type: 'bank' });
        }
        return Promise.reject(
          new BadRequestException('Institución no encontrada'),
        );
      },
    ),
    assertAccountOwned: jest.fn(),
    assertCardOwned: jest.fn(),
    assertCategoryVisible: jest.fn(),
    assertCategoryMatchesTransactionType: jest.fn(),
    assertExpenseCategory: jest.fn(),
    assertParentCategory: jest.fn(),
    assertDebitAccountAlignment: jest.fn().mockResolvedValue({
      id: 'acc-1',
      institutionId: 'inst-1',
    }),
    assertLoanAccountAlignment: jest.fn(),
    assertAccountInstitutionChangeAllowed: jest.fn(),
    assertInstitutionCanArchive: jest.fn(),
    ...overrides,
  } as unknown as FinanceOwnershipService;
}

function purgeMock(): PurgeInstrumentLedgerUseCase {
  return {
    forAccount: jest.fn().mockResolvedValue(undefined),
    forCard: jest.fn().mockResolvedValue(undefined),
  } as unknown as PurgeInstrumentLedgerUseCase;
}

function ensureMock(): EnsureCashInstitutionUseCase {
  return {
    execute: jest.fn().mockResolvedValue(undefined),
  } as unknown as EnsureCashInstitutionUseCase;
}

function baseCurrencyMock(currency = 'DOP'): ResolveUserBaseCurrencyUseCase {
  return {
    execute: jest.fn().mockResolvedValue(currency),
  } as unknown as ResolveUserBaseCurrencyUseCase;
}

/**
 * Builds the service with the cash-institution mock in place, so every spec
 * keeps passing only the collaborators it cares about.
 */
function createService(
  repo: CatalogRepository,
  ownership: FinanceOwnershipService,
  purge: PurgeInstrumentLedgerUseCase,
  logos?: never,
  users?: never,
) {
  return new CatalogService(
    repo,
    ownership,
    purge,
    ensureMock(),
    baseCurrencyMock(),
    logos,
    users,
    configMock(),
  );
}

describe('CatalogService cards archive', () => {
  const findCardById = jest.fn();
  const updateCard = jest.fn();
  const listCards = jest.fn();
  const findAccountById = jest.fn();

  const repo = {
    findCardById,
    updateCard,
    listCards,
    findAccountById,
  } as unknown as CatalogRepository;

  const service = createService(repo, ownershipMock(), purgeMock());

  const debitCard = {
    id: 'card-1',
    userId: 'user-1',
    institutionId: 'inst-1',
    accountId: 'acc-1',
    name: 'Debit',
    type: 'DEBIT',
    network: null,
    lastFour: '1234',
    statementClosingDay: null,
    paymentDueDay: null,
    color: null,
    isActive: true,
    institution: { name: 'Bank' },
    account: { id: 'acc-1', name: 'Main' },
    balances: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    findCardById.mockResolvedValue(debitCard);
    findAccountById.mockResolvedValue({ id: 'acc-1', userId: 'user-1' });
    updateCard.mockImplementation(
      (_userId: string, _id: string, data: { isActive?: boolean }) =>
        Promise.resolve({
          ...debitCard,
          isActive: data.isActive ?? debitCard.isActive,
        }),
    );
  });

  it('archives a DEBIT card with PATCH isActive false without requiring accountId', async () => {
    const result = await service.updateCard('user-1', 'card-1', {
      isActive: false,
    });

    expect(result.isActive).toBe(false);
    expect(updateCard).toHaveBeenCalledWith(
      'user-1',
      'card-1',
      expect.objectContaining({ isActive: false }),
    );
    expect(updateCard.mock.calls[0]?.[2]).not.toHaveProperty('accountId');
  });

  it('DELETE deactivates the card', async () => {
    await expect(service.deactivateCard('user-1', 'card-1')).resolves.toEqual({
      success: true,
    });
    expect(updateCard).toHaveBeenCalledWith('user-1', 'card-1', {
      isActive: false,
    });
  });

  it('returns 404 when archiving another user card', async () => {
    findCardById.mockResolvedValue(null);
    updateCard.mockResolvedValue(null);
    await expect(
      service.updateCard('user-1', 'other', { isActive: false }),
    ).rejects.toThrow(/no encontrad/i);
    await expect(service.deactivateCard('user-1', 'other')).rejects.toThrow(
      /no encontrad/i,
    );
  });
});

describe('CatalogService createAccount', () => {
  const createAccount = jest.fn();
  const listInstitutions = jest.fn();
  const findAccountById = jest.fn();

  const repo = {
    createAccount,
    listInstitutions,
    findAccountById,
    findSystemCashInstitution: jest.fn().mockResolvedValue({ id: 'cash-inst' }),
  } as unknown as CatalogRepository;

  const service = createService(repo, ownershipMock(), purgeMock());

  const created = {
    id: 'acc-1',
    userId: 'user-1',
    institutionId: 'inst-1',
    name: 'Nómina',
    type: 'CHECKING',
    currency: 'DOP',
    accountNumberLast4: '5678',
    balance: { toString: () => '0.00' },
    color: null,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    institutionRef: { name: 'Banco' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    listInstitutions.mockResolvedValue([{ id: 'inst-1', name: 'Banco' }]);
    createAccount.mockResolvedValue(created);
  });

  it('rejects accounts without a known institution', async () => {
    await expect(
      service.createAccount('user-1', {
        name: 'Nómina',
        type: 'CHECKING',
        institutionId: 'missing',
        accountNumber: '001122335678',
      }),
    ).rejects.toThrow(/Institución no encontrada/i);
    expect(createAccount).not.toHaveBeenCalled();
  });

  it('rejects bank accounts without an account number', async () => {
    await expect(
      service.createAccount('user-1', {
        name: 'Nómina',
        type: 'CHECKING',
        institutionId: 'inst-1',
      }),
    ).rejects.toThrow(/account number/i);
    expect(createAccount).not.toHaveBeenCalled();
  });

  it('rejects a CASH account that includes an account number', async () => {
    await expect(
      service.createAccount('user-1', {
        name: 'Efectivo',
        type: 'CASH',
        accountNumber: '001122335678',
      }),
    ).rejects.toThrow(/CASH/i);
    expect(createAccount).not.toHaveBeenCalled();
  });

  it('creates an account with institutionId and accountNumber', async () => {
    const result = await service.createAccount('user-1', {
      name: 'Nómina',
      type: 'CHECKING',
      institutionId: 'inst-1',
      accountNumber: '0011-2233-5678',
    });

    expect(createAccount).toHaveBeenCalledWith('user-1', {
      name: 'Nómina',
      type: 'CHECKING',
      institutionId: 'inst-1',
      accountNumber: expect.stringMatching(BASE64_CIPHERTEXT),
      accountNumberLast4: '5678',
      accountNumberHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(result).toMatchObject({
      id: 'acc-1',
      institutionId: 'inst-1',
      institutionName: 'Banco',
      accountNumberLast4: '5678',
    });
    expect(result).not.toHaveProperty('institution');
    expect(result).not.toHaveProperty('accountNumber');
  });

  it('creates a CASH account inside the system Efectivo institution', async () => {
    createAccount.mockResolvedValue({
      ...created,
      type: 'CASH',
      institutionId: 'cash-inst',
      accountNumberLast4: null,
      institutionRef: { name: 'Efectivo' },
    });

    const result = await service.createAccount('user-1', {
      name: 'Efectivo',
      type: 'CASH',
    });

    expect(createAccount).toHaveBeenCalledWith('user-1', {
      name: 'Efectivo',
      type: 'CASH',
      institutionId: 'cash-inst',
      accountNumber: null,
      accountNumberLast4: null,
      accountNumberHash: null,
    });
    expect(result).toMatchObject({
      type: 'CASH',
      institutionId: 'cash-inst',
      accountNumberLast4: null,
    });
  });
});

describe('CatalogService updateAccount number', () => {
  const updateAccount = jest.fn();
  const findAccountById = jest.fn();
  const repo = {
    updateAccount,
    findAccountById,
  } as unknown as CatalogRepository;
  const service = createService(repo, ownershipMock(), purgeMock());

  const existing = {
    id: 'acc-1',
    userId: 'user-1',
    institutionId: 'inst-1',
    name: 'Nómina',
    type: 'CHECKING',
    currency: 'DOP',
    accountNumber: null,
    accountNumberLast4: null,
    accountNumberHash: null,
    balance: { toString: () => '0.00' },
    color: null,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    institutionRef: { name: 'Banco' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    findAccountById.mockResolvedValue(existing);
  });

  it('rejects updating a bank account that still has no account number', async () => {
    await expect(
      service.updateAccount('user-1', 'acc-1', { name: 'Nómina 2' }),
    ).rejects.toThrow(/account number/i);
    expect(updateAccount).not.toHaveBeenCalled();
  });

  it('saves the account number on edit', async () => {
    updateAccount.mockResolvedValue({
      ...existing,
      accountNumberLast4: '5678',
    });
    const result = await service.updateAccount('user-1', 'acc-1', {
      accountNumber: '001122335678',
    });
    expect(updateAccount).toHaveBeenCalledWith(
      'acc-1',
      'user-1',
      expect.objectContaining({
        accountNumber: expect.stringMatching(BASE64_CIPHERTEXT),
        accountNumberLast4: '5678',
        accountNumberHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(result.accountNumberLast4).toBe('5678');
  });
});

describe('CatalogService createCard lastFour', () => {
  const createCard = jest.fn();
  const repo = { createCard } as unknown as CatalogRepository;
  const service = createService(repo, ownershipMock(), purgeMock());

  it('rejects cards without lastFour', async () => {
    await expect(
      service.createCard('user-1', {
        institutionId: 'inst-1',
        name: 'Visa',
        type: 'CREDIT',
        lastFour: '',
      }),
    ).rejects.toThrow(/lastFour/i);
    expect(createCard).not.toHaveBeenCalled();
  });
});

describe('CatalogService archive institution', () => {
  it('refuses to archive while active dependents remain', async () => {
    const ownership = ownershipMock();
    ownership.assertInstitutionCanArchive = jest.fn().mockRejectedValue(
      new ConflictException({
        message:
          'Cannot archive institution while active accounts, cards, email sources, or loans remain',
        dependents: { accounts: 1, cards: 0, emailSources: 0, loans: 0 },
      }),
    );

    const updateInstitution = jest.fn();
    const service = createService(
      {
        updateInstitution,
        findInstitution: jest.fn().mockResolvedValue({ id: 'inst-1' }),
      } as unknown as CatalogRepository,
      ownership,
      purgeMock(),
    );

    await expect(
      service.deactivateInstitution('user-1', 'inst-1'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        dependents: { accounts: 1, cards: 0, emailSources: 0, loans: 0 },
      }),
    });
    expect(updateInstitution).not.toHaveBeenCalled();
  });
});

describe('CatalogService updateCardBalance', () => {
  const findCardById = jest.fn();
  const upsertCardBalance = jest.fn();
  const service = createService(
    { findCardById, upsertCardBalance } as unknown as CatalogRepository,
    ownershipMock(),
    purgeMock(),
  );

  beforeEach(() => {
    jest.clearAllMocks();
    findCardById.mockResolvedValue({
      id: 'card-1',
      type: 'CREDIT',
    });
    upsertCardBalance.mockResolvedValue({
      id: 'bal-1',
      cardId: 'card-1',
      currency: 'DOP',
      balance: 42467,
      creditLimit: 48000,
    });
  });

  it('requires creditLimit for CREDIT cards', async () => {
    await expect(
      service.updateCardBalance('user-1', 'card-1', {
        currency: 'DOP',
        balance: 42467,
      }),
    ).rejects.toThrow(/CREDIT requieren creditLimit/i);
    expect(upsertCardBalance).not.toHaveBeenCalled();
  });

  it('rejects balances for DEBIT cards because they inherit the linked account balance', async () => {
    findCardById.mockResolvedValue({ id: 'card-1', type: 'DEBIT' });

    await expect(
      service.updateCardBalance('user-1', 'card-1', {
        currency: 'DOP',
        balance: 42467,
      }),
    ).rejects.toThrow(/DEBIT cards use their linked account balance/i);
    expect(upsertCardBalance).not.toHaveBeenCalled();
  });

  it('upserts a CREDIT balance when the limit is provided', async () => {
    const result = await service.updateCardBalance('user-1', 'card-1', {
      currency: 'DOP',
      balance: 42467,
      creditLimit: 48000,
    });
    expect(upsertCardBalance).toHaveBeenCalledWith(
      'user-1',
      'card-1',
      'DOP',
      42467,
      48000,
    );
    expect(result).toMatchObject({
      balance: '42467',
      creditLimit: '48000',
    });
  });
});

describe('CatalogService deleteCardBalance', () => {
  const findCardById = jest.fn();
  const deleteCardBalance = jest.fn();
  const service = createService(
    { findCardById, deleteCardBalance } as unknown as CatalogRepository,
    ownershipMock(),
    purgeMock(),
  );

  beforeEach(() => {
    jest.clearAllMocks();
    findCardById.mockResolvedValue({ id: 'card-1', type: 'CREDIT' });
    deleteCardBalance.mockResolvedValue({ count: 1 });
  });

  it('deletes the selected currency owned by the user', async () => {
    await expect(
      service.deleteCardBalance('user-1', 'card-1', 'dop'),
    ).resolves.toEqual({ success: true });

    expect(deleteCardBalance).toHaveBeenCalledWith('user-1', 'card-1', 'dop');
  });

  it('rejects deleting balances from DEBIT cards', async () => {
    findCardById.mockResolvedValue({ id: 'card-1', type: 'DEBIT' });

    await expect(
      service.deleteCardBalance('user-1', 'card-1', 'DOP'),
    ).rejects.toThrow(/DEBIT cards use their linked account balance/i);
    expect(deleteCardBalance).not.toHaveBeenCalled();
  });

  it('rejects a missing currency balance', async () => {
    deleteCardBalance.mockResolvedValue({ count: 0 });

    await expect(
      service.deleteCardBalance('user-1', 'card-1', 'USD'),
    ).rejects.toThrow('Saldo de tarjeta no encontrado');
  });
});

describe('CatalogService categories', () => {
  const listCategories = jest.fn();
  const createCategory = jest.fn();
  const updateCategory = jest.fn();
  const repo = {
    listCategories,
    createCategory,
    updateCategory,
  } as unknown as CatalogRepository;
  const assertParentCategory = jest.fn();
  const assertCategoryVisible = jest.fn();
  const ownership = ownershipMock({
    assertParentCategory,
    assertCategoryVisible,
  });
  const service = createService(repo, ownership, purgeMock());

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('defaults create type to EXPENSE when omitted', async () => {
    createCategory.mockResolvedValue({
      id: 'cat-1',
      name: 'Comida',
      type: 'EXPENSE',
    });

    await service.createCategory('user-1', { name: 'Comida' });

    expect(createCategory).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ name: 'Comida', type: 'EXPENSE' }),
    );
  });

  it('rejects an INCOME child under an EXPENSE parent', async () => {
    assertParentCategory.mockRejectedValue(
      new BadRequestException('La categoría padre debe tener el mismo tipo'),
    );

    await expect(
      service.createCategory('user-1', {
        name: 'Bonus',
        parentId: 'parent-exp',
        type: 'INCOME',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(createCategory).not.toHaveBeenCalled();
  });

  it('changes type on a root and cascades it to children', async () => {
    assertCategoryVisible.mockResolvedValue({
      id: 'cat-1',
      parentId: null,
      type: 'EXPENSE',
    });
    updateCategory.mockResolvedValue({
      id: 'cat-1',
      name: 'Mercado',
      type: 'INCOME',
      parentId: null,
    });

    await service.updateCategory('user-1', 'cat-1', {
      name: 'Mercado',
      type: 'INCOME',
    });

    expect(updateCategory).toHaveBeenCalledWith(
      'user-1',
      'cat-1',
      {
        name: 'Mercado',
        icon: undefined,
        color: undefined,
        parentId: undefined,
        type: 'INCOME',
      },
      'INCOME',
    );
  });

  it('rejects a type change while the category still has a parent', async () => {
    assertCategoryVisible.mockResolvedValue({
      id: 'cat-1',
      parentId: 'parent-1',
      type: 'EXPENSE',
    });

    await expect(
      service.updateCategory('user-1', 'cat-1', { type: 'INCOME' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updateCategory).not.toHaveBeenCalled();
  });

  it('clears parentId when the patch sends null', async () => {
    assertCategoryVisible.mockResolvedValue({
      id: 'cat-1',
      parentId: 'parent-1',
      type: 'EXPENSE',
    });
    updateCategory.mockResolvedValue({
      id: 'cat-1',
      parentId: null,
      type: 'EXPENSE',
    });

    await service.updateCategory('user-1', 'cat-1', { parentId: null });

    expect(assertParentCategory).not.toHaveBeenCalled();
    expect(updateCategory).toHaveBeenCalledWith(
      'user-1',
      'cat-1',
      {
        name: undefined,
        icon: undefined,
        color: undefined,
        parentId: null,
      },
      undefined,
    );
  });

  it('checks a new parent against the resulting type', async () => {
    assertParentCategory.mockResolvedValue({
      id: 'parent-2',
    });
    assertCategoryVisible.mockResolvedValue({
      id: 'cat-1',
      parentId: null,
      type: 'EXPENSE',
    });
    updateCategory.mockResolvedValue({
      id: 'cat-1',
      parentId: 'parent-2',
      type: 'EXPENSE',
    });

    await service.updateCategory('user-1', 'cat-1', { parentId: 'parent-2' });

    expect(assertParentCategory).toHaveBeenCalledWith(
      'user-1',
      'parent-2',
      'cat-1',
      'EXPENSE',
    );
  });

  it('passes type filter to the repository', async () => {
    listCategories.mockResolvedValue([]);
    await service.listCategories('user-1', 'INCOME');
    expect(listCategories).toHaveBeenCalledWith('user-1', 'INCOME');
  });
});

describe('CatalogService hard delete', () => {
  it('deletes an account after purging ledger and debit cards', async () => {
    const forAccount = jest.fn().mockResolvedValue({ count: 1, rows: [] });
    const findAccountById = jest.fn().mockResolvedValue({ id: 'acc-1' });
    const deleteAccount = jest.fn().mockResolvedValue({ count: 1 });
    const service = createService(
      {
        findAccountById,
        deleteAccount,
      } as unknown as CatalogRepository,
      ownershipMock(),
      {
        forAccount,
        forCard: jest.fn(),
      } as unknown as PurgeInstrumentLedgerUseCase,
    );

    await expect(service.deleteAccount('user-1', 'acc-1')).resolves.toEqual({
      success: true,
    });
    expect(forAccount).toHaveBeenCalledWith('user-1', 'acc-1');
    expect(deleteAccount).toHaveBeenCalledWith({
      userId: 'user-1',
      id: 'acc-1',
      movements: [],
    });
  });

  it('returns 404 when deleting a missing account', async () => {
    const service = createService(
      {
        findAccountById: jest.fn().mockResolvedValue(null),
      } as unknown as CatalogRepository,
      ownershipMock(),
      purgeMock(),
    );
    await expect(service.deleteAccount('user-1', 'missing')).rejects.toThrow(
      /no encontrad/i,
    );
  });

  it('rejects deleting the base-currency Efectivo account', async () => {
    const deleteAccount = jest.fn();
    const service = createService(
      {
        findAccountById: jest.fn().mockResolvedValue({
          id: 'acc-cash',
          type: 'CASH',
          currency: 'DOP',
        }),
        deleteAccount,
      } as unknown as CatalogRepository,
      ownershipMock(),
      purgeMock(),
    );

    await expect(service.deleteAccount('user-1', 'acc-cash')).rejects.toThrow(
      /moneda base/i,
    );
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('deletes a cash account in another currency', async () => {
    const forAccount = jest.fn().mockResolvedValue({ count: 1, rows: [] });
    const deleteAccount = jest.fn().mockResolvedValue({ count: 1 });
    const service = createService(
      {
        findAccountById: jest.fn().mockResolvedValue({
          id: 'acc-usd',
          type: 'CASH',
          currency: 'USD',
        }),
        deleteAccount,
      } as unknown as CatalogRepository,
      ownershipMock(),
      {
        forAccount,
        forCard: jest.fn(),
      } as unknown as PurgeInstrumentLedgerUseCase,
    );

    await expect(service.deleteAccount('user-1', 'acc-usd')).resolves.toEqual({
      success: true,
    });
    expect(deleteAccount).toHaveBeenCalled();
  });

  it('deletes a card after purging its ledger', async () => {
    const forCard = jest.fn().mockResolvedValue({ count: 1, rows: [] });
    const deleteCard = jest.fn().mockResolvedValue({ count: 1 });
    const service = createService(
      {
        findCardById: jest.fn().mockResolvedValue({ id: 'card-1' }),
        deleteCard,
      } as unknown as CatalogRepository,
      ownershipMock(),
      {
        forAccount: jest.fn(),
        forCard,
      } as unknown as PurgeInstrumentLedgerUseCase,
    );

    await expect(service.deleteCard('user-1', 'card-1')).resolves.toEqual({
      success: true,
    });
    expect(forCard).toHaveBeenCalledWith('user-1', 'card-1');
    expect(deleteCard).toHaveBeenCalledWith({
      userId: 'user-1',
      id: 'card-1',
      movements: [],
    });
  });

  it('cascades institution delete through accounts, remaining cards, sources, and loans', async () => {
    const forAccount = jest.fn().mockResolvedValue({ count: 1, rows: [] });
    const forCard = jest.fn().mockResolvedValue({ count: 1, rows: [] });
    const findInstitution = jest.fn().mockResolvedValue({ id: 'inst-1' });
    const listAccountsByInstitution = jest
      .fn()
      .mockResolvedValue([{ id: 'acc-1' }]);
    const listCardsByInstitution = jest
      .fn()
      .mockResolvedValue([{ id: 'card-credit' }]);
    const deleteInstitution = jest.fn().mockResolvedValue({ count: 1 });
    const service = createService(
      {
        findInstitution,
        listAccountsByInstitution,
        listCardsByInstitution,
        deleteInstitution,
      } as unknown as CatalogRepository,
      ownershipMock(),
      { forAccount, forCard } as unknown as PurgeInstrumentLedgerUseCase,
    );

    await expect(
      service.deleteInstitution('user-1', 'inst-1'),
    ).resolves.toEqual({ success: true });
    expect(forAccount).toHaveBeenCalledWith('user-1', 'acc-1');
    expect(forCard).toHaveBeenCalledWith('user-1', 'card-credit');
    expect(deleteInstitution).toHaveBeenCalledWith({
      userId: 'user-1',
      id: 'inst-1',
      movements: [],
    });
  });

  it('archives an institution via PATCH isActive false, not by deleting the row', async () => {
    const assertInstitutionCanArchive = jest.fn();
    const updateInstitution = jest.fn().mockResolvedValue({
      id: 'inst-1',
      name: 'Bank',
      color: null,
      logoUrl: null,
      country: 'DO',
      isActive: false,
    });
    const service = createService(
      {
        updateInstitution,
        findInstitution: jest.fn().mockResolvedValue({ id: 'inst-1' }),
      } as unknown as CatalogRepository,
      ownershipMock({ assertInstitutionCanArchive }),
      purgeMock(),
    );

    await expect(
      service.updateInstitution('user-1', 'inst-1', { isActive: false }),
    ).resolves.toMatchObject({ isActive: false });
    expect(assertInstitutionCanArchive).toHaveBeenCalledWith(
      'user-1',
      'inst-1',
    );
    expect(updateInstitution).toHaveBeenCalledWith('user-1', 'inst-1', {
      isActive: false,
    });
  });
});

describe('CatalogService card credit', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  const utcDay = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  it('returns available credit and the next cycle in the user timezone', async () => {
    jest.useFakeTimers({ now: new Date('2026-02-01T12:00:00.000Z') });
    const findCardById = jest.fn().mockResolvedValue({
      id: 'card-1',
      institutionId: 'inst-1',
      institution: { name: 'Banco', logoUrl: null },
      accountId: null,
      account: null,
      name: 'Visa',
      type: 'CREDIT',
      network: 'VISA',
      lastFour: '1234',
      statementClosingDay: 31,
      paymentDueDay: 15,
      color: null,
      isActive: true,
      balances: [
        { id: 'bal-1', currency: 'DOP', balance: 38000, creditLimit: 50000 },
      ],
      transactions: [
        {
          type: 'DEBIT',
          status: 'PENDING',
          ledgerAmount: 1000,
          ledgerCurrency: 'DOP',
          transactionDate: utcDay('2026-02-01'),
        },
      ],
    });
    const users = {
      findById: jest
        .fn()
        .mockResolvedValue({ timezone: 'America/Santo_Domingo' }),
    };
    const service = createService(
      { findCardById } as unknown as CatalogRepository,
      ownershipMock(),
      purgeMock(),
      undefined,
      users as never,
    );

    const card = await service.getCard('user-1', 'card-1');

    expect(card.balances).toEqual([
      {
        id: 'bal-1',
        currency: 'DOP',
        balance: '38000',
        creditLimit: '50000',
        availableCredit: '37000',
      },
    ]);
    expect(card.nextStatementDate).toBe('2026-02-28');
    expect(card.nextPaymentDueDate).toBe('2026-03-15');
  });

  it('leaves available credit and the cycle empty without a limit or closing day', async () => {
    jest.useFakeTimers({ now: new Date('2026-02-01T12:00:00.000Z') });
    const findCardById = jest.fn().mockResolvedValue({
      id: 'card-1',
      institutionId: 'inst-1',
      institution: { name: 'Banco', logoUrl: null },
      accountId: null,
      account: null,
      name: 'Visa',
      type: 'CREDIT',
      network: null,
      lastFour: '1234',
      statementClosingDay: null,
      paymentDueDay: null,
      color: null,
      isActive: true,
      balances: [
        { id: 'bal-1', currency: 'DOP', balance: 0, creditLimit: null },
      ],
      transactions: [],
    });
    const service = createService(
      { findCardById } as unknown as CatalogRepository,
      ownershipMock(),
      purgeMock(),
    );

    const card = await service.getCard('user-1', 'card-1');

    expect(card.balances[0].availableCredit).toBeNull();
    expect(card.nextStatementDate).toBeNull();
    expect(card.nextPaymentDueDate).toBeNull();
  });
});

describe('CatalogService cash institution rules', () => {
  const systemInstitution = {
    id: 'cash-inst',
    name: 'Efectivo',
    type: 'cash',
    isSystem: true,
  };

  it('rejects editing the system institution', async () => {
    const service = createService(
      {
        findInstitution: jest.fn().mockResolvedValue(systemInstitution),
        updateInstitution: jest.fn(),
      } as unknown as CatalogRepository,
      ownershipMock(),
      purgeMock(),
    );

    await expect(
      service.updateInstitution('user-1', 'cash-inst', { name: 'Caja' }),
    ).rejects.toThrow(/sistema/i);
  });

  it('rejects archiving the system institution', async () => {
    const service = createService(
      {
        findInstitution: jest.fn().mockResolvedValue(systemInstitution),
        updateInstitution: jest.fn(),
      } as unknown as CatalogRepository,
      ownershipMock(),
      purgeMock(),
    );

    await expect(
      service.deactivateInstitution('user-1', 'cash-inst'),
    ).rejects.toThrow(/sistema/i);
  });

  it('rejects deleting the system institution', async () => {
    const deleteInstitution = jest.fn();
    const service = createService(
      {
        findInstitution: jest.fn().mockResolvedValue(systemInstitution),
        deleteInstitution,
      } as unknown as CatalogRepository,
      ownershipMock(),
      purgeMock(),
    );

    await expect(
      service.deleteInstitution('user-1', 'cash-inst'),
    ).rejects.toThrow(/sistema/i);
    expect(deleteInstitution).not.toHaveBeenCalled();
  });

  it('rejects turning another institution into cash', async () => {
    const updateInstitution = jest.fn();
    const service = createService(
      {
        findInstitution: jest
          .fn()
          .mockResolvedValue({ id: 'inst-1', isSystem: false }),
        updateInstitution,
      } as unknown as CatalogRepository,
      ownershipMock(),
      purgeMock(),
    );

    await expect(
      service.updateInstitution('user-1', 'inst-1', { type: 'cash' }),
    ).rejects.toThrow(/Efectivo/i);
    expect(updateInstitution).not.toHaveBeenCalled();
  });

  it('rejects creating another cash institution', async () => {
    const createInstitution = jest.fn();
    const service = createService(
      { createInstitution } as unknown as CatalogRepository,
      ownershipMock(),
      purgeMock(),
    );

    await expect(
      service.createInstitution('user-1', { name: 'Efectivo', type: 'cash' }),
    ).rejects.toThrow(/Efectivo/i);
    expect(createInstitution).not.toHaveBeenCalled();
  });

  it('rejects a card on the cash institution', async () => {
    const createCard = jest.fn();
    const service = createService(
      { createCard } as unknown as CatalogRepository,
      ownershipMock({
        assertInstitutionAcceptsBankProducts: jest
          .fn()
          .mockRejectedValue(
            new BadRequestException(
              'Efectivo no admite tarjetas, préstamos ni sincronización por correo',
            ),
          ),
      }),
      purgeMock(),
    );

    await expect(
      service.createCard('user-1', {
        institutionId: 'cash-inst',
        name: 'Visa',
        type: 'CREDIT',
        lastFour: '1234',
      }),
    ).rejects.toThrow(/Efectivo no admite/i);
    expect(createCard).not.toHaveBeenCalled();
  });

  it('rejects opening a cash account outside Efectivo', async () => {
    const createAccount = jest.fn();
    const service = createService(
      {
        createAccount,
        findSystemCashInstitution: jest
          .fn()
          .mockResolvedValue({ id: 'cash-inst' }),
      } as unknown as CatalogRepository,
      ownershipMock(),
      purgeMock(),
    );

    await expect(
      service.createAccount('user-1', {
        name: 'Efectivo',
        type: 'CASH',
        institutionId: 'inst-1',
      }),
    ).rejects.toThrow(/Efectivo/i);
    expect(createAccount).not.toHaveBeenCalled();
  });
});
