import { NotFoundException } from '@nestjs/common';
import type { ReceivableSharesRepository } from '../infrastructure/receivable-shares.repository';
import { PublicReceivableSharesService } from './public-receivable-shares.service';

const now = new Date('2026-10-16T12:00:00.000Z');

function shareRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'share-1',
    debtorName: 'Carlos Méndez',
    updatedAt: now,
    isActive: true,
    revokedAt: null,
    expiresAt: null,
    user: { fullName: 'Jarvin Collado', timezone: 'America/Santo_Domingo' },
    items: [
      {
        receivable: {
          id: 'rec-1',
          description: 'Préstamo celular',
          notes: null,
          amount: 8500,
          paidAmount: 3000,
          currency: 'DOP',
          status: 'PARTIAL',
          dueDate: null,
          createdAt: now,
          payments: [],
        },
      },
    ],
    ...overrides,
  };
}

function setup() {
  const repo = { findShareByToken: jest.fn() };
  const service = new PublicReceivableSharesService(
    repo as unknown as ReceivableSharesRepository,
  );
  return { repo, service };
}

describe('PublicReceivableSharesService', () => {
  it('returns the read-only payload for an active link', async () => {
    const { repo, service } = setup();
    repo.findShareByToken.mockResolvedValue(shareRow());

    const payload = await service.getByToken('tok-1', now);

    expect(repo.findShareByToken).toHaveBeenCalledWith('tok-1');
    expect(payload.ownerFirstName).toBe('Jarvin');
    expect(payload.totalsByCurrency).toEqual([
      { currency: 'DOP', amount: '8500', paid: '3000', pending: '5500' },
    ]);
  });

  it('answers the same 404 for a missing token', async () => {
    const { repo, service } = setup();
    repo.findShareByToken.mockResolvedValue(null);

    await expect(service.getByToken('nope', now)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('answers 404 for a revoked link', async () => {
    const { repo, service } = setup();
    repo.findShareByToken.mockResolvedValue(
      shareRow({ isActive: false, revokedAt: now }),
    );

    await expect(service.getByToken('tok-1', now)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('answers 404 for an expired link', async () => {
    const { repo, service } = setup();
    repo.findShareByToken.mockResolvedValue(
      shareRow({ expiresAt: new Date('2026-10-15T00:00:00.000Z') }),
    );

    await expect(service.getByToken('tok-1', now)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('answers 404 for an inactive link', async () => {
    const { repo, service } = setup();
    repo.findShareByToken.mockResolvedValue(shareRow({ isActive: false }));

    await expect(service.getByToken('tok-1', now)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
