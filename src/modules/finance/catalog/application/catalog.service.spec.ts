import { CatalogService } from './catalog.service';
import type { CatalogRepository } from '../infrastructure/catalog.repository';

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

  const service = new CatalogService(repo);

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
