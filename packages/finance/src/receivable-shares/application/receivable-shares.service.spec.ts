import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';
import type { ReceivableSharesRepository } from '../infrastructure/receivable-shares.repository';
import { ReceivableSharesService } from './receivable-shares.service';

const now = new Date('2026-10-16T12:00:00.000Z');

function shareRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'share-1',
    userId: 'user-1',
    token: 'tok-1',
    debtorName: 'Carlos Méndez',
    isActive: true,
    expiresAt: null,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function setup() {
  const repo = {
    findReceivablesForShare: jest
      .fn()
      .mockResolvedValue([{ id: 'rec-1' }, { id: 'rec-2' }]),
    createShare: jest.fn().mockResolvedValue(shareRow()),
    listShares: jest.fn().mockResolvedValue([]),
    revokeShare: jest.fn(),
    rotateShareToken: jest.fn(),
  };
  const config = {
    getOrThrow: jest
      .fn()
      .mockReturnValue('http://localhost:5173,https://app.example.com'),
  };
  const service = new ReceivableSharesService(
    repo as unknown as ReceivableSharesRepository,
    config as unknown as ConfigService<Env, true>,
  );
  return { repo, service };
}

describe('ReceivableSharesService', () => {
  it('creates the link with a fresh token and the first CORS origin', async () => {
    const { repo, service } = setup();

    const created = await service.create('user-1', {
      receivableIds: ['rec-1', 'rec-2'],
      debtorName: 'Carlos Méndez',
    });

    expect(repo.createShare).toHaveBeenCalledTimes(1);
    const input = repo.createShare.mock.calls[0][0];
    expect(input).toMatchObject({
      userId: 'user-1',
      debtorName: 'Carlos Méndez',
      receivableIds: ['rec-1', 'rec-2'],
    });
    expect(input.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(created).toMatchObject({
      id: 'share-1',
      token: 'tok-1',
      url: 'http://localhost:5173/c/tok-1',
      debtorName: 'Carlos Méndez',
      isActive: true,
      items: ['rec-1', 'rec-2'],
    });
  });

  it('accepts receivables in different currencies', async () => {
    const { repo, service } = setup();
    repo.findReceivablesForShare.mockResolvedValue([
      { id: 'rec-1', currency: 'DOP' },
      { id: 'rec-2', currency: 'USD' },
    ]);

    await expect(
      service.create('user-1', {
        receivableIds: ['rec-1', 'rec-2'],
        debtorName: 'Carlos Méndez',
      }),
    ).resolves.toBeDefined();

    expect(repo.createShare).toHaveBeenCalledTimes(1);
  });

  it('rejects when one receivable is missing or belongs to another user', async () => {
    const { repo, service } = setup();
    repo.findReceivablesForShare.mockResolvedValue([{ id: 'rec-1' }]);

    await expect(
      service.create('user-1', {
        receivableIds: ['rec-1', 'rec-2'],
        debtorName: 'Carlos Méndez',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(repo.createShare).not.toHaveBeenCalled();
  });

  it('lists the user links with the receivable count', async () => {
    const { repo, service } = setup();
    repo.listShares.mockResolvedValue([shareRow({ _count: { items: 2 } })]);

    const listed = await service.list('user-1');

    expect(listed).toEqual([
      {
        id: 'share-1',
        token: 'tok-1',
        url: 'http://localhost:5173/c/tok-1',
        debtorName: 'Carlos Méndez',
        isActive: true,
        expiresAt: null,
        revokedAt: null,
        createdAt: now,
        itemCount: 2,
      },
    ]);
  });

  it('revokes a link', async () => {
    const { repo, service } = setup();
    repo.revokeShare.mockResolvedValue(
      shareRow({
        isActive: false,
        revokedAt: now,
        _count: { items: 2 },
      }),
    );

    const revoked = await service.revoke('user-1', 'share-1', now);

    expect(repo.revokeShare).toHaveBeenCalledWith('user-1', 'share-1', now);
    expect(revoked.isActive).toBe(false);
    expect(revoked.revokedAt).toBe(now);
  });

  it('fails to revoke a link from another user', async () => {
    const { repo, service } = setup();
    repo.revokeShare.mockResolvedValue(null);

    await expect(
      service.revoke('user-1', 'share-1', now),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('regenerates the token, reactivating the link', async () => {
    const { repo, service } = setup();
    repo.rotateShareToken.mockResolvedValue(
      shareRow({ token: 'tok-2', _count: { items: 2 } }),
    );

    const regenerated = await service.regenerate('user-1', 'share-1');

    expect(repo.rotateShareToken).toHaveBeenCalledWith(
      'user-1',
      'share-1',
      expect.stringMatching(/^[A-Za-z0-9_-]{40,}$/),
    );
    expect(regenerated.url).toBe('http://localhost:5173/c/tok-2');
  });

  it('fails to regenerate a link that does not exist', async () => {
    const { repo, service } = setup();
    repo.rotateShareToken.mockResolvedValue(null);

    await expect(
      service.regenerate('user-1', 'share-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
