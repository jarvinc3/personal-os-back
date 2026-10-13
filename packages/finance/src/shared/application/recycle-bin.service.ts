import { Injectable } from '@nestjs/common';
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
  ) {}

  async get(userId: string): Promise<RecycleBinView> {
    const [institutions, accounts, cards, loans, deletions] = await Promise.all(
      [
        this.recycleBin.listArchivedInstitutions(userId),
        this.recycleBin.listArchivedAccounts(userId),
        this.recycleBin.listArchivedCards(userId),
        this.recycleBin.listArchivedLoans(userId),
        this.journal.listPending(userId),
      ],
    );

    return {
      archived: [
        ...institutions.map((item) => ({
          type: 'institution' as const,
          id: item.id,
          label: item.name,
        })),
        ...accounts.map((item) => ({
          type: 'account' as const,
          id: item.id,
          label: item.name,
        })),
        ...cards.map((item) => ({
          type: 'card' as const,
          id: item.id,
          label: item.name,
        })),
        ...loans.map((item) => ({
          type: 'loan' as const,
          id: item.id,
          label: item.lenderName,
        })),
      ],
      deleted: deletions.map((entry) => {
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
    };
  }
}
