import { digitsOnly } from '../../shared/domain/account-number';
import { OPERATION_LEG_ROLE } from '../../shared/domain/transfer';
import type { MovementClass } from '../domain/movement-class';
import { accountMatchesHint } from './resolve-ledger-target-from-hints';

export const TRANSFER_REVIEW_REASON = {
  ACCOUNT_MISSING: 'TRANSFER_ACCOUNT_MISSING',
  ACCOUNT_NOT_FOUND: 'TRANSFER_ACCOUNT_NOT_FOUND',
  ACCOUNT_AMBIGUOUS: 'TRANSFER_ACCOUNT_AMBIGUOUS',
  ACCOUNT_HINT_UNSUPPORTED: 'TRANSFER_ACCOUNT_HINT_UNSUPPORTED',
  REFERENCE_CONFLICT: 'TRANSFER_REFERENCE_CONFLICT',
} as const;

export type TransferAccountCandidate = {
  id: string;
  accountNumberLast4: string | null;
  type?: string | null;
};

export type TransferAccountResolution =
  | { kind: 'unique'; accountId: string }
  | { kind: 'missing'; reason: typeof TRANSFER_REVIEW_REASON.ACCOUNT_MISSING }
  | {
      kind: 'unsupported';
      reason: typeof TRANSFER_REVIEW_REASON.ACCOUNT_HINT_UNSUPPORTED;
    }
  | {
      kind: 'not_found';
      reason: typeof TRANSFER_REVIEW_REASON.ACCOUNT_NOT_FOUND;
    }
  | {
      kind: 'ambiguous';
      reason: typeof TRANSFER_REVIEW_REASON.ACCOUNT_AMBIGUOUS;
      candidateAccountIds: string[];
    };

/**
 * Resolves the user's own account for a transfer. Cards, cash accounts and the
 * default account are never candidates; a missing hint is not inferred.
 */
export function resolveTransferAccount({
  accountNumberHint,
  hasCardLast4Hint,
  accounts,
}: {
  accountNumberHint: string | null;
  hasCardLast4Hint: boolean;
  accounts: TransferAccountCandidate[];
}): TransferAccountResolution {
  const hint = digitsOnly(accountNumberHint);
  if (!hint) {
    if (hasCardLast4Hint) {
      return {
        kind: 'unsupported',
        reason: TRANSFER_REVIEW_REASON.ACCOUNT_HINT_UNSUPPORTED,
      };
    }
    return {
      kind: 'missing',
      reason: TRANSFER_REVIEW_REASON.ACCOUNT_MISSING,
    };
  }

  const matches = accounts.filter(
    (account) =>
      account.type !== 'CASH' &&
      accountMatchesHint(account.accountNumberLast4, hint),
  );
  if (matches.length === 0) {
    return {
      kind: 'not_found',
      reason: TRANSFER_REVIEW_REASON.ACCOUNT_NOT_FOUND,
    };
  }
  if (matches.length > 1) {
    return {
      kind: 'ambiguous',
      reason: TRANSFER_REVIEW_REASON.ACCOUNT_AMBIGUOUS,
      candidateAccountIds: matches.map((account) => account.id),
    };
  }
  return { kind: 'unique', accountId: matches[0].id };
}

export type TransferLegRole =
  typeof OPERATION_LEG_ROLE.SOURCE | typeof OPERATION_LEG_ROLE.DESTINATION;

export type TransferLegIdentity = {
  type: 'DEBIT' | 'CREDIT';
  legRole: TransferLegRole;
};

export function transferLegIdentity(
  movementClass: MovementClass,
): TransferLegIdentity | null {
  if (movementClass === 'TRANSFER_OUT') {
    return { type: 'DEBIT', legRole: OPERATION_LEG_ROLE.SOURCE };
  }
  if (movementClass === 'TRANSFER_IN') {
    return { type: 'CREDIT', legRole: OPERATION_LEG_ROLE.DESTINATION };
  }
  return null;
}

export type ExistingTransferLeg = {
  id: string;
  type: string;
  accountId: string | null;
  amount: { toString(): string } | number;
  currency: string;
  transactionDate: Date;
};

export type TransferImportDecision =
  | { kind: 'import' }
  | { kind: 'duplicate'; transactionId: string }
  | {
      kind: 'conflict';
      reason: typeof TRANSFER_REVIEW_REASON.REFERENCE_CONFLICT;
      candidateTransactionIds: string[];
    };

type IncomingTransferLeg = {
  type: 'DEBIT' | 'CREDIT';
  accountId: string;
  amount: number;
  currency: string;
  transactionDate: Date;
};

function isSameLeg(
  existing: ExistingTransferLeg,
  incoming: IncomingTransferLeg,
): boolean {
  return (
    existing.type === incoming.type &&
    existing.accountId === incoming.accountId &&
    Number(existing.amount) === incoming.amount &&
    existing.currency === incoming.currency &&
    existing.transactionDate.getTime() === incoming.transactionDate.getTime()
  );
}

function isLegitimateCounterpart(
  existing: ExistingTransferLeg,
  incoming: IncomingTransferLeg,
): boolean {
  return (
    existing.type !== incoming.type &&
    existing.accountId !== null &&
    existing.accountId !== incoming.accountId
  );
}

/**
 * Classifies rows that already share the bank reference. The same leg is a
 * replay; one opposite leg on another account is the legitimate counterpart
 * and imports as its own leg; anything else waits for review with no new row.
 */
export function classifyTransferImport({
  incoming,
  existing,
}: {
  incoming: IncomingTransferLeg;
  existing: ExistingTransferLeg[];
}): TransferImportDecision {
  const sameLeg = existing.find((row) => isSameLeg(row, incoming));
  if (sameLeg) {
    return { kind: 'duplicate', transactionId: sameLeg.id };
  }
  if (existing.length === 0) {
    return { kind: 'import' };
  }
  if (existing.length === 1 && isLegitimateCounterpart(existing[0], incoming)) {
    return { kind: 'import' };
  }
  return {
    kind: 'conflict',
    reason: TRANSFER_REVIEW_REASON.REFERENCE_CONFLICT,
    candidateTransactionIds: existing.map((row) => row.id),
  };
}
