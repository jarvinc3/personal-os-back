import { Injectable } from '@nestjs/common';
import {
  clampPageLimit,
  toCursorPage,
  type CursorQueryDto,
} from '@personal-os/core';
import { LogoService } from '@personal-os/logos';
import {
  deletedAccountInstitutionId,
  deletedEntryLabel,
  deletedInstitutionLogo,
  type RecycleBinView,
  type StoredLogoRow,
} from '../domain/recycle-bin';
import {
  DELETION_ENTITY,
  type DeletionEntity,
  type DeletionSnapshot,
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
    const deletedAccountLogos = await this.listDeletedAccountLogos(
      userId,
      page.items,
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
        const snapshot = entry.snapshot as unknown as DeletionSnapshot;
        return {
          type: entityType,
          id: entry.entityId,
          label: deletedEntryLabel(entityType, snapshot),
          logoUrl: this.deletedLogoUrl(
            entityType,
            snapshot,
            deletedAccountLogos,
          ),
          deletedAt: entry.deletedAt.toISOString(),
          sizeBytes: entry.sizeBytes,
        };
      }),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    };
  }

  private async listDeletedAccountLogos(
    userId: string,
    entries: readonly PendingDeletionEntry[],
  ): Promise<Map<string, StoredLogoRow>> {
    const institutionIds = entries
      .filter((entry) => entry.entityType === DELETION_ENTITY.account)
      .map((entry) =>
        deletedAccountInstitutionId(
          entry.snapshot as unknown as DeletionSnapshot,
        ),
      )
      .filter((id): id is string => id !== null);
    if (institutionIds.length === 0) {
      return new Map();
    }
    const rows = await this.recycleBin.listInstitutionLogos(userId, [
      ...new Set(institutionIds),
    ]);
    return new Map(rows.map((row) => [row.id, row]));
  }

  private deletedLogoUrl(
    entityType: DeletionEntity,
    snapshot: DeletionSnapshot,
    accountLogos: Map<string, StoredLogoRow>,
  ): string | null {
    if (entityType === DELETION_ENTITY.institution) {
      return this.logos.resolveUrl(deletedInstitutionLogo(snapshot));
    }
    if (entityType !== DELETION_ENTITY.account) {
      return null;
    }
    const institutionId = deletedAccountInstitutionId(snapshot);
    if (!institutionId) {
      return null;
    }
    return this.logos.resolveUrl(accountLogos.get(institutionId) ?? null);
  }
}

type PendingDeletionEntry = Awaited<
  ReturnType<DeletionJournalRepository['listPendingPage']>
>[number];
