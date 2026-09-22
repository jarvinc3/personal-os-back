import { CatalogService } from './catalog.service';
import type { CatalogRepository } from '../infrastructure/catalog.repository';
import type { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import type { PurgeInstrumentLedgerUseCase } from '../../ledger/application/purge-instrument-ledger.use-case';
import { BadRequestException, ConflictException } from '@nestjs/common';

function ownershipMock(
  overrides: Partial<{
    assertInstitutionCanArchive: jest.Mock;
  }> = {},
): FinanceOwnershipService {
  return {
    assertInstitutionOwned: jest.fn((_userId: string, id: string) => {
      if (id === 'inst-1') return Promise.resolve({ id, name: 'Banco' });
      return Promise.reject(new BadRequestException('Institution not found'));
    }),
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

  const service = new CatalogService(repo, ownershipMock(), purgeMock());

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
    updateCard.mockImplementation((_userId: string, _id: string, data: { isActive?: boolean }) =>
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
    ).rejects.toThrow(/not found/i);
    await expect(service.deactivateCard('user-1', 'other')).rejects.toThrow(
      /not found/i,
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
  } as unknown as CatalogRepository;

  const service = new CatalogService(repo, ownershipMock(), purgeMock());

  const created = {
    id: 'acc-1',
    userId: 'user-1',
    institutionId: 'inst-1',
    name: 'Nómina',
    type: 'CHECKING',
    currency: 'DOP',
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
      }),
    ).rejects.toThrow(/Institution not found/i);
    expect(createAccount).not.toHaveBeenCalled();
  });

  it('creates an account with institutionId only', async () => {
    const result = await service.createAccount('user-1', {
      name: 'Nómina',
      type: 'CHECKING',
      institutionId: 'inst-1',
    });

    expect(createAccount).toHaveBeenCalledWith('user-1', {
      name: 'Nómina',
      type: 'CHECKING',
      institutionId: 'inst-1',
    });
    expect(result).toMatchObject({
      id: 'acc-1',
      institutionId: 'inst-1',
      institutionName: 'Banco',
    });
    expect(result).not.toHaveProperty('institution');
  });

  it('creates a CASH account without an institution', async () => {
    createAccount.mockResolvedValue({
      ...created,
      type: 'CASH',
      institutionId: null,
      institutionRef: null,
    });

    const result = await service.createAccount('user-1', {
      name: 'Efectivo',
      type: 'CASH',
    });

    expect(createAccount).toHaveBeenCalledWith('user-1', {
      name: 'Efectivo',
      type: 'CASH',
    });
    expect(result).toMatchObject({
      type: 'CASH',
      institutionId: null,
    });
  });
});

describe('CatalogService archive institution', () => {
  it('refuses to archive while active dependents remain', async () => {
    const ownership = ownershipMock();
    ownership.assertInstitutionCanArchive = jest
      .fn()
      .mockRejectedValue(
        new ConflictException({
          message:
            'Cannot archive institution while active accounts, cards, email sources, or loans remain',
          dependents: { accounts: 1, cards: 0, emailSources: 0, loans: 0 },
        }),
      );

    const updateInstitution = jest.fn();
    const service = new CatalogService(
      { updateInstitution } as unknown as CatalogRepository,
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
  const service = new CatalogService(
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
    ).rejects.toThrow(/CREDIT cards require creditLimit/i);
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

describe('CatalogService categories', () => {
  const listCategories = jest.fn();
  const createCategory = jest.fn();
  const updateCategory = jest.fn();
  const repo = {
    listCategories,
    createCategory,
    updateCategory,
  } as unknown as CatalogRepository;
  const ownership = ownershipMock();
  const service = new CatalogService(repo, ownership, purgeMock());

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
    (ownership.assertParentCategory as jest.Mock).mockRejectedValue(
      new BadRequestException('Parent category must have the same type'),
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

  it('does not write type on update', async () => {
    updateCategory.mockResolvedValue({
      id: 'cat-1',
      name: 'Mercado',
      type: 'EXPENSE',
    });

    await service.updateCategory('user-1', 'cat-1', { name: 'Mercado' });

    expect(updateCategory).toHaveBeenCalledWith('user-1', 'cat-1', {
      name: 'Mercado',
      icon: undefined,
      color: undefined,
      parentId: undefined,
    });
  });

  it('passes type filter to the repository', async () => {
    listCategories.mockResolvedValue([]);
    await service.listCategories('user-1', 'INCOME');
    expect(listCategories).toHaveBeenCalledWith('user-1', 'INCOME');
  });
});

describe('CatalogService hard delete', () => {
  it('deletes an account after purging ledger and debit cards', async () => {
    const forAccount = jest.fn().mockResolvedValue(undefined);
    const findAccountById = jest.fn().mockResolvedValue({ id: 'acc-1' });
    const deleteCardsByAccountId = jest.fn().mockResolvedValue({ count: 1 });
    const deleteAccount = jest.fn().mockResolvedValue({ count: 1 });
    const service = new CatalogService(
      {
        findAccountById,
        deleteCardsByAccountId,
        deleteAccount,
      } as unknown as CatalogRepository,
      ownershipMock(),
      { forAccount, forCard: jest.fn() } as unknown as PurgeInstrumentLedgerUseCase,
    );

    await expect(service.deleteAccount('user-1', 'acc-1')).resolves.toEqual({
      success: true,
    });
    expect(forAccount).toHaveBeenCalledWith('user-1', 'acc-1');
    expect(deleteCardsByAccountId).toHaveBeenCalledWith('user-1', 'acc-1');
    expect(deleteAccount).toHaveBeenCalledWith('user-1', 'acc-1');
  });

  it('returns 404 when deleting a missing account', async () => {
    const service = new CatalogService(
      { findAccountById: jest.fn().mockResolvedValue(null) } as unknown as CatalogRepository,
      ownershipMock(),
      purgeMock(),
    );
    await expect(service.deleteAccount('user-1', 'missing')).rejects.toThrow(
      /not found/i,
    );
  });

  it('deletes a card after purging its ledger', async () => {
    const forCard = jest.fn().mockResolvedValue(undefined);
    const service = new CatalogService(
      {
        findCardById: jest.fn().mockResolvedValue({ id: 'card-1' }),
        deleteCard: jest.fn().mockResolvedValue({ count: 1 }),
      } as unknown as CatalogRepository,
      ownershipMock(),
      { forAccount: jest.fn(), forCard } as unknown as PurgeInstrumentLedgerUseCase,
    );

    await expect(service.deleteCard('user-1', 'card-1')).resolves.toEqual({
      success: true,
    });
    expect(forCard).toHaveBeenCalledWith('user-1', 'card-1');
  });

  it('cascades institution delete through accounts, remaining cards, sources, and loans', async () => {
    const forAccount = jest.fn().mockResolvedValue(undefined);
    const forCard = jest.fn().mockResolvedValue(undefined);
    const findInstitution = jest.fn().mockResolvedValue({ id: 'inst-1' });
    const listAccountsByInstitution = jest
      .fn()
      .mockResolvedValue([{ id: 'acc-1' }]);
    const listCardsByInstitution = jest
      .fn()
      .mockResolvedValue([{ id: 'card-credit' }]);
    const findAccountById = jest.fn().mockResolvedValue({ id: 'acc-1' });
    const deleteCardsByAccountId = jest.fn().mockResolvedValue({ count: 1 });
    const deleteAccount = jest.fn().mockResolvedValue({ count: 1 });
    const findCardById = jest.fn().mockResolvedValue({ id: 'card-credit' });
    const deleteCard = jest.fn().mockResolvedValue({ count: 1 });
    const deleteEmailSourcesByInstitution = jest
      .fn()
      .mockResolvedValue({ count: 1 });
    const deleteLoansByInstitution = jest.fn().mockResolvedValue({ count: 1 });
    const deleteInstitution = jest.fn().mockResolvedValue({ count: 1 });

    const service = new CatalogService(
      {
        findInstitution,
        listAccountsByInstitution,
        listCardsByInstitution,
        findAccountById,
        deleteCardsByAccountId,
        deleteAccount,
        findCardById,
        deleteCard,
        deleteEmailSourcesByInstitution,
        deleteLoansByInstitution,
        deleteInstitution,
      } as unknown as CatalogRepository,
      ownershipMock(),
      { forAccount, forCard } as unknown as PurgeInstrumentLedgerUseCase,
    );

    await expect(service.deleteInstitution('user-1', 'inst-1')).resolves.toEqual(
      { success: true },
    );
    expect(forAccount).toHaveBeenCalledWith('user-1', 'acc-1');
    expect(forCard).toHaveBeenCalledWith('user-1', 'card-credit');
    expect(deleteEmailSourcesByInstitution).toHaveBeenCalledWith(
      'user-1',
      'inst-1',
    );
    expect(deleteLoansByInstitution).toHaveBeenCalledWith('user-1', 'inst-1');
    expect(deleteInstitution).toHaveBeenCalledWith('user-1', 'inst-1');
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
    const service = new CatalogService(
      { updateInstitution } as unknown as CatalogRepository,
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
