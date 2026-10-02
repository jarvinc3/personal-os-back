import { CatalogRepository } from './catalog.repository';
import type { PrismaService } from '@personal-os/database';

describe('CatalogRepository createAccount', () => {
  it('always persists institutionId and omits empty color', async () => {
    const created = {
      id: 'acc-1',
      userId: 'user-1',
      name: 'QA Cuenta',
      type: 'SAVINGS',
      currency: 'DOP',
      balance: 0,
      institutionId: 'inst-1',
      color: null,
      isActive: true,
      institutionRef: { name: 'Banco' },
    };
    const create = jest.fn().mockResolvedValue(created);
    const prisma = {
      finAccount: { create },
    } as unknown as PrismaService;

    const repo = new CatalogRepository(prisma);
    await repo.createAccount('user-1', {
      name: 'QA Cuenta',
      type: 'SAVINGS',
      institutionId: 'inst-1',
      accountNumber: '12345678',
    });

    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(data).toEqual({
      userId: 'user-1',
      name: 'QA Cuenta',
      type: 'SAVINGS',
      currency: 'DOP',
      balance: 0,
      institutionId: 'inst-1',
      accountNumber: '12345678',
      isDefaultForInstitution: false,
    });
    expect(Object.keys(data)).not.toContain('institution');
    expect(Object.keys(data)).not.toContain('color');
  });

  it('includes color when provided', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'acc-2' });
    const prisma = {
      finAccount: { create },
    } as unknown as PrismaService;

    const repo = new CatalogRepository(prisma);
    await repo.createAccount('user-1', {
      name: 'Nómina',
      type: 'CHECKING',
      currency: 'usd',
      institutionId: 'inst-1',
      color: '#22c55e',
      accountNumber: '001122335678',
    });

    const data = create.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(data).toEqual({
      userId: 'user-1',
      name: 'Nómina',
      type: 'CHECKING',
      currency: 'usd',
      balance: 0,
      institutionId: 'inst-1',
      accountNumber: '001122335678',
      isDefaultForInstitution: false,
      color: '#22c55e',
    });
  });
});
