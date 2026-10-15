import type { CursorQueryDto } from '@personal-os/core';
import type { LogoRow, LogoService } from '@personal-os/logos';
import type { DeletionJournalRepository } from '../infrastructure/deletion-journal.repository';
import type { RecycleBinRepository } from '../infrastructure/recycle-bin.repository';
import { RecycleBinService } from './recycle-bin.service';

function logoServiceMock(): LogoService {
  return {
    resolveUrl: (row?: LogoRow | null) =>
      row?.customLogoPath ?? row?.logoPath ?? row?.logoUrl ?? null,
  } as unknown as LogoService;
}

describe('RecycleBinService', () => {
  const listArchivedInstitutions = jest.fn();
  const listArchivedAccounts = jest.fn();
  const listArchivedCards = jest.fn();
  const listArchivedLoans = jest.fn();
  const listPendingPage = jest.fn();

  const repo = {
    listArchivedInstitutions,
    listArchivedAccounts,
    listArchivedCards,
    listArchivedLoans,
  } as unknown as RecycleBinRepository;
  const journal = { listPendingPage } as unknown as DeletionJournalRepository;
  const service = new RecycleBinService(repo, journal, logoServiceMock());

  beforeEach(() => {
    jest.clearAllMocks();
    listArchivedAccounts.mockResolvedValue([]);
    listArchivedCards.mockResolvedValue([]);
    listArchivedLoans.mockResolvedValue([]);
    listPendingPage.mockResolvedValue([]);
  });

  it('resolves the institution logo for institutions and their accounts', async () => {
    listArchivedInstitutions.mockResolvedValue([
      {
        id: 'inst-1',
        name: 'Banco X',
        logoPath: 'logos/bhd.png',
        customLogoPath: null,
        logoUrl: null,
      },
    ]);
    listArchivedAccounts.mockResolvedValue([
      {
        id: 'acc-1',
        name: 'Ahorro',
        institutionRef: {
          logoPath: 'logos/popular.png',
          customLogoPath: null,
          logoUrl: null,
        },
      },
    ]);

    const view = await service.get('user-1', {} as CursorQueryDto);

    expect(view.archived).toEqual([
      {
        type: 'institution',
        id: 'inst-1',
        label: 'Banco X',
        logoUrl: 'logos/bhd.png',
      },
      {
        type: 'account',
        id: 'acc-1',
        label: 'Ahorro',
        logoUrl: 'logos/popular.png',
      },
    ]);
  });

  it('returns a null logo when the institution has none', async () => {
    listArchivedInstitutions.mockResolvedValue([
      {
        id: 'inst-1',
        name: 'Banco X',
        logoPath: null,
        customLogoPath: null,
        logoUrl: null,
      },
    ]);

    const view = await service.get('user-1', {} as CursorQueryDto);

    expect(view.archived[0].logoUrl).toBeNull();
  });
});
