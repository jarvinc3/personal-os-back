import {
  isAtmMovementClass,
  isTransferMovementClass,
  type MovementClass,
} from '../domain/movement-class';
import { TRANSFER_REFERENCE_WINDOW_MS } from '../../shared/domain/transfer';

export type ImportTransferCandidate = {
  id: string;
  type: string;
  accountId?: string | null;
  externalReference?: string | null;
  amount: { toString(): string } | number;
  currency: string;
  transactionDate: Date;
  transferGroupId: string | null;
  categoryId: string | null;
  description: string | null;
  merchant: string | null;
  notes: string | null;
  aiMetadata: unknown;
  account?: { institutionId?: string | null; type?: string | null } | null;
  card?: { institutionId?: string | null } | null;
};

const DEFAULT_MATCH_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
/** Two BHD notices for the same transfer arrive about two minutes apart. */
export const DOUBLE_NOTICE_WINDOW_MS = 10 * 60 * 1000;
/** Dos correos con la misma referencia tienen más margen para emparejar. */
export const REFERENCE_MATCH_WINDOW_MS = TRANSFER_REFERENCE_WINDOW_MS;
const FEE_TOLERANCE = 50;
const FEE_TOLERANCE_RATIO = 0.02;

function amountOf(row: ImportTransferCandidate): number {
  return Number(row.amount);
}

function institutionOf(row: ImportTransferCandidate): string | null {
  return row.account?.institutionId ?? row.card?.institutionId ?? null;
}

export function movementClassOf(row: {
  type: string;
  aiMetadata: unknown;
}): MovementClass {
  const fromMeta =
    row.aiMetadata &&
    typeof row.aiMetadata === 'object' &&
    !Array.isArray(row.aiMetadata)
      ? (row.aiMetadata as { movementClass?: MovementClass }).movementClass
      : undefined;
  return fromMeta ?? (row.type === 'CREDIT' ? 'INCOME' : 'PURCHASE');
}

function groupSize(
  rows: ImportTransferCandidate[],
  groupId: string | null,
): number {
  if (!groupId) {
    return 1;
  }
  return rows.filter((row) => row.transferGroupId === groupId).length;
}

export function isUnpairedTransferCandidate(
  row: ImportTransferCandidate,
  all: ImportTransferCandidate[],
): boolean {
  const movement = movementClassOf(row);
  if (isAtmMovementClass(movement)) {
    return false;
  }
  if (!isTransferMovementClass(movement) && row.transferGroupId == null) {
    return false;
  }
  if (
    isTransferMovementClass(movement) &&
    groupSize(all, row.transferGroupId) > 1
  ) {
    return false;
  }
  return groupSize(all, row.transferGroupId) <= 1;
}

function amountsMatch(left: number, right: number): 'exact' | 'fee' | null {
  if (left === right) {
    return 'exact';
  }
  const delta = Math.abs(left - right);
  const max = Math.max(left, right);
  if (delta <= FEE_TOLERANCE || delta <= max * FEE_TOLERANCE_RATIO) {
    return 'fee';
  }
  return null;
}

export type TransferMatchResult = {
  match: ImportTransferCandidate | null;
  /** Candidatos que compiten; con más de uno la pata queda pendiente. */
  candidateIds: string[];
};

function matchWindowMs(
  row: ImportTransferCandidate,
  other: ImportTransferCandidate,
): number {
  if (
    row.externalReference &&
    row.externalReference === other.externalReference
  ) {
    return REFERENCE_MATCH_WINDOW_MS;
  }
  return DEFAULT_MATCH_WINDOW_MS;
}

export function pickTransferMatch(
  row: ImportTransferCandidate,
  candidates: ImportTransferCandidate[],
): TransferMatchResult {
  const opposite = row.type === 'DEBIT' ? 'CREDIT' : 'DEBIT';
  const institution = institutionOf(row);
  const amount = amountOf(row);
  const scored = candidates
    .filter((other) => other.id !== row.id)
    .filter((other) => other.type === opposite)
    .filter((other) => other.currency === row.currency)
    .filter((other) => {
      const sameAccountDoubleNotice =
        row.accountId != null &&
        other.accountId != null &&
        row.accountId === other.accountId;
      if (sameAccountDoubleNotice) {
        const delta = Math.abs(
          other.transactionDate.getTime() - row.transactionDate.getTime(),
        );
        return delta <= DOUBLE_NOTICE_WINDOW_MS;
      }
      return institutionOf(other) !== institution;
    })
    .filter((other) => {
      const delta = Math.abs(
        other.transactionDate.getTime() - row.transactionDate.getTime(),
      );
      return delta <= matchWindowMs(row, other);
    })
    .map((other) => ({
      other,
      closeness: amountsMatch(amount, amountOf(other)),
    }))
    .filter(
      (
        item,
      ): item is {
        other: ImportTransferCandidate;
        closeness: 'exact' | 'fee';
      } => item.closeness !== null,
    );

  const exact = scored.filter((item) => item.closeness === 'exact');
  // Un monto exacto descarta la tolerancia de comisión; el resto compite.
  const pool = exact.length > 0 ? exact : scored;
  return {
    match: pool.length === 1 ? pool[0].other : null,
    candidateIds: pool.map((item) => item.other.id),
  };
}

export function uniqueCashAccountId(
  accounts: Array<{ id: string }>,
): string | null {
  return accounts.length === 1 ? accounts[0].id : null;
}
