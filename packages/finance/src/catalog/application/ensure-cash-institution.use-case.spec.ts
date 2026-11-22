import { Prisma } from '@personal-os/database';
import type { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import type { CatalogCashRepository } from '../infrastructure/catalog-cash.repository';
import { EnsureCashInstitutionUseCase } from './ensure-cash-institution.use-case';

describe('EnsureCashInstitutionUseCase', () => {
  const findSystemCashInstitution = jest.fn();
  const createSystemCashInstitution = jest.fn();
  const assignInstitutionlessCashAccounts = jest.fn();
  const findFirstCashAccount = jest.fn();
  const ensureCashAccount = jest.fn();
  const baseCurrencyExecute = jest.fn().mockResolvedValue('DOP');

  const repo = {
    findSystemCashInstitution,
    createSystemCashInstitution,
    assignInstitutionlessCashAccounts,
    findFirstCashAccount,
    ensureCashAccount,
  } as unknown as CatalogCashRepository;

  const createUseCase = () =>
    new EnsureCashInstitutionUseCase(repo, {
      execute: baseCurrencyExecute,
    } as unknown as ResolveUserBaseCurrencyUseCase);

  beforeEach(() => {
    jest.clearAllMocks();
    baseCurrencyExecute.mockResolvedValue('DOP');
    assignInstitutionlessCashAccounts.mockResolvedValue({ count: 0 });
    findFirstCashAccount.mockResolvedValue(null);
    ensureCashAccount.mockResolvedValue(undefined);
  });

  it('keeps the existing institution and its cash account', async () => {
    findSystemCashInstitution.mockResolvedValue({ id: 'cash-1' });
    findFirstCashAccount.mockResolvedValue({ id: 'cash-acc-1' });

    await expect(createUseCase().execute('user-1')).resolves.toBeUndefined();
    expect(createSystemCashInstitution).not.toHaveBeenCalled();
    expect(assignInstitutionlessCashAccounts).not.toHaveBeenCalled();
    expect(ensureCashAccount).not.toHaveBeenCalled();
  });

  it('restores the base-currency account when the institution survived a wipe', async () => {
    findSystemCashInstitution.mockResolvedValue({ id: 'cash-1' });
    findFirstCashAccount.mockResolvedValue(null);

    await expect(createUseCase().execute('user-1')).resolves.toBeUndefined();
    expect(createSystemCashInstitution).not.toHaveBeenCalled();
    expect(ensureCashAccount).toHaveBeenCalledWith('user-1', {
      institutionId: 'cash-1',
      name: 'Efectivo',
      currency: 'DOP',
    });
  });

  it('creates Efectivo, moves loose cash and adds the base-currency account', async () => {
    findSystemCashInstitution.mockResolvedValue(null);
    createSystemCashInstitution.mockResolvedValue({
      id: 'cash-1',
      name: 'Efectivo',
    });

    await expect(createUseCase().execute('user-1')).resolves.toBeUndefined();
    expect(createSystemCashInstitution).toHaveBeenCalledWith('user-1');
    expect(assignInstitutionlessCashAccounts).toHaveBeenCalledWith(
      'user-1',
      'cash-1',
    );
    expect(baseCurrencyExecute).toHaveBeenCalledWith('user-1');
    expect(ensureCashAccount).toHaveBeenCalledWith('user-1', {
      institutionId: 'cash-1',
      name: 'Efectivo',
      currency: 'DOP',
    });
  });

  it('does not add a default account when the user already has cash', async () => {
    findSystemCashInstitution.mockResolvedValue(null);
    createSystemCashInstitution.mockResolvedValue({
      id: 'cash-1',
      name: 'Efectivo',
    });
    findFirstCashAccount.mockResolvedValue({ id: 'cash-acc-1' });

    await createUseCase().execute('user-1');

    expect(ensureCashAccount).not.toHaveBeenCalled();
  });

  it('recovers from a concurrent create via the unique index', async () => {
    findSystemCashInstitution
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'cash-1' });
    createSystemCashInstitution.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(createUseCase().execute('user-1')).resolves.toBeUndefined();
    expect(assignInstitutionlessCashAccounts).toHaveBeenCalledWith(
      'user-1',
      'cash-1',
    );
  });

  it('rethrows an unexpected creation error', async () => {
    findSystemCashInstitution.mockResolvedValue(null);
    createSystemCashInstitution.mockRejectedValue(new Error('database down'));

    await expect(createUseCase().execute('user-1')).rejects.toThrow(
      'database down',
    );
  });
});
