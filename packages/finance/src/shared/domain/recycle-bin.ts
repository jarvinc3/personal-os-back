import {
  DELETION_ENTITY,
  DELETION_MODEL,
  type DeletionEntity,
  type DeletionModel,
  type DeletionSnapshot,
} from './deletion-snapshot';

export const RECYCLE_BIN_ARCHIVED_TYPES = [
  DELETION_ENTITY.institution,
  DELETION_ENTITY.account,
  DELETION_ENTITY.card,
  DELETION_ENTITY.loan,
] as const;

export type RecycleBinArchivedType =
  (typeof RECYCLE_BIN_ARCHIVED_TYPES)[number];

export type RecycleBinArchivedItem = {
  type: RecycleBinArchivedType;
  id: string;
  label: string;
  /** Resolved institution logo, so the card can show the brand. */
  logoUrl: string | null;
};

export type RecycleBinDeletedItem = {
  type: DeletionEntity;
  id: string;
  label: string | null;
  /** Resolved institution logo, so a deleted institution shows its brand. */
  logoUrl: string | null;
  deletedAt: string;
  /** Snapshot size, so the UI can warn before a slow restore. */
  sizeBytes: number;
};

export type RecycleBinView = {
  archived: RecycleBinArchivedItem[];
  items: RecycleBinDeletedItem[];
  nextCursor: string | null;
  hasMore: boolean;
};

type DeletedLabelTarget = {
  model: DeletionModel;
  field: string;
};

const DELETED_LABEL_TARGET: Record<DeletionEntity, DeletedLabelTarget | null> =
  {
    [DELETION_ENTITY.account]: { model: DELETION_MODEL.account, field: 'name' },
    [DELETION_ENTITY.budget]: null,
    [DELETION_ENTITY.card]: { model: DELETION_MODEL.card, field: 'name' },
    [DELETION_ENTITY.category]: {
      model: DELETION_MODEL.category,
      field: 'name',
    },
    [DELETION_ENTITY.institution]: {
      model: DELETION_MODEL.institution,
      field: 'name',
    },
    [DELETION_ENTITY.loan]: { model: DELETION_MODEL.loan, field: 'lenderName' },
    [DELETION_ENTITY.receivable]: {
      model: DELETION_MODEL.receivable,
      field: 'debtorName',
    },
    [DELETION_ENTITY.reconciliation]: {
      model: DELETION_MODEL.reconciliation,
      field: 'note',
    },
    [DELETION_ENTITY.savingsGoal]: {
      model: DELETION_MODEL.savingsGoal,
      field: 'name',
    },
    [DELETION_ENTITY.transaction]: {
      model: DELETION_MODEL.transaction,
      field: 'description',
    },
  };

/** Stored logo columns of a row kept in a deletion snapshot. */
export type StoredLogoRow = {
  logoPath: string | null;
  customLogoPath: string | null;
  logoUrl: string | null;
};

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Logo columns of the institution kept in a deletion snapshot, so the recycle
 * bin can show the brand of a deleted institution.
 */
export function deletedInstitutionLogo(
  snapshot: DeletionSnapshot,
): StoredLogoRow | null {
  const row = snapshot.rows.find(
    (entry) => entry.model === DELETION_MODEL.institution,
  );
  if (!row) {
    return null;
  }
  return {
    logoPath: stringOrNull(row.values.logoPath),
    customLogoPath: stringOrNull(row.values.customLogoPath),
    logoUrl: stringOrNull(row.values.logoUrl),
  };
}

/**
 * Institution a deleted account belonged to, so the recycle bin can resolve
 * the brand from the institution that still owns the logo.
 */
export function deletedAccountInstitutionId(
  snapshot: DeletionSnapshot,
): string | null {
  const row = snapshot.rows.find(
    (entry) => entry.model === DELETION_MODEL.account,
  );
  const institutionId = row?.values.institutionId;
  return typeof institutionId === 'string' ? institutionId : null;
}

/**
 * Reads the visible label of a deleted record from its journal copy. Budgets
 * have no own name, so they come back without a label.
 */
export function deletedEntryLabel(
  entityType: DeletionEntity,
  snapshot: DeletionSnapshot,
): string | null {
  const target = DELETED_LABEL_TARGET[entityType];
  if (!target) {
    return null;
  }
  const row = snapshot.rows.find((entry) => entry.model === target.model);
  const value = row?.values[target.field];
  if (typeof value !== 'string') {
    return null;
  }
  const label = value.trim();
  return label === '' ? null : label;
}
