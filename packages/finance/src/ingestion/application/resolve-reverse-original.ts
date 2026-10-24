import type { LedgerQueryService } from '../../ledger/application/ledger-query.service';
import type { LedgerTransactionRow } from '../../ledger/application/ports/ledger.repository.port';

/**
 * Resolves the transaction a reversal notice points to. Falls back to the
 * reversal heuristic, then to already-REVERSED rows so a re-sent reversal can
 * be detected as a duplicate instead of retried forever.
 */
export async function findReverseOriginal(
  ledger: LedgerQueryService,
  userId: string,
  params: {
    reverseEmailMessageId: string | null;
    reverseOriginalRef: string | null;
    merchant: string | null;
    amount: number;
    currency: string;
    aroundDate: Date;
  },
): Promise<LedgerTransactionRow | null> {
  if (params.reverseOriginalRef) {
    const byReference = await ledger.findTransactionByExternalReference(
      userId,
      params.reverseOriginalRef,
    );
    if (byReference) {
      return byReference;
    }
  }
  if (params.reverseEmailMessageId) {
    const byEmail = await ledger.findTransactionByImportReference(
      params.reverseEmailMessageId,
      userId,
    );
    if (byEmail && byEmail.userId === userId) {
      return byEmail;
    }
  }
  const candidates = await ledger.findReverseCandidates(userId, {
    amount: params.amount,
    currency: params.currency,
    merchant: params.merchant,
    aroundDate: params.aroundDate,
  });
  if (candidates[0]) {
    return candidates[0];
  }
  const reversed = await ledger.findReverseCandidates(userId, {
    amount: params.amount,
    currency: params.currency,
    merchant: params.merchant,
    aroundDate: params.aroundDate,
    statuses: ['REVERSED'],
  });
  return reversed[0] ?? null;
}
