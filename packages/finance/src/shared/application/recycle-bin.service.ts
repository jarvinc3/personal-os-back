import { Injectable } from '@nestjs/common';
import {
  clampPageLimit,
  toCursorPage,
  type CursorQueryDto,
} from '@personal-os/core';
import { LogoService } from '@personal-os/logos';
import { deletedEntryLabel, type RecycleBinView } from '../domain/recycle-bin';
import type {
  DeletionEntity,
  DeletionSnapshot,
} from '../domain/deletion-snapshot';
import { DeletionJournalRepository } from '../infrastructure/deletion-journal.repository';
import { RecycleBinRepository } from '../infrastructure/recycle-bin.repository';

@Injectable()
export class RecycleBinService {
  constructor(
    private readonly recycleBin: RecycleBinRepository,
    private readonly journal: DeletionJournalRepository,
    private readonly logos: LogoService,
  ) {}

  async get(userId: string, query: CursorQueryDto): Promise<RecycleBinView> {
    const [institutions, accounts, cards, loans, deletions] = await Promise.all(
      [
        this.recycleBin.listArchivedInstitutions(userId),
        this.recycleBin.listArchivedAccounts(userId),
        this.recycleBin.listArchivedCards(userId),
        this.recycleBin.listArchivedLoans(userId),
        this.journal.listPendingPage(userId, query),
      ],
    );
    const page = toCursorPage(deletions, clampPageLimit(query.limit), (entry) =>
      entry.deletedAt.toISOString(),
    );

    return {
      archived: [
        ...institutions.map((item) => ({
          type: 'institution' as const,
          id: item.id,
          label: item.name,
          logoUrl: this.logos.resolveUrl(item),
        })),
        ...accounts.map((item) => ({
          type: 'account' as const,
          id: item.id,
          label: item.name,
          logoUrl: this.logos.resolveUrl(item.institutionRef),
        })),
        ...cards.map((item) => ({
          type: 'card' as const,
          id: item.id,
          label: item.name,
          logoUrl: null,
        })),
        ...loans.map((item) => ({
          type: 'loan' as const,
          id: item.id,
          label: item.lenderName,
          logoUrl: null,
        })),
      ],
      items: page.items.map((entry) => {
        const entityType = entry.entityType as DeletionEntity;
        return {
          type: entityType,
          id: entry.entityId,
          label: deletedEntryLabel(
            entityType,
            entry.snapshot as unknown as DeletionSnapshot,
          ),
          deletedAt: entry.deletedAt.toISOString(),
          sizeBytes: entry.sizeBytes,
        };
      }),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    };
  }
}
