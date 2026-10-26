import type { CursorQueryDto } from '@personal-os/core';
import type { EmailMessageOutcome } from '../email-message-outcome';
import type { EmailMatchCandidate } from '../match-email-transfers';

/** Domain input, not a relation to a mailbox or an AI-owned table. */
export interface FinancialImportCandidate {
  id: string;
  sourceId: string;
  sourceReference: string;
  outcome: EmailMessageOutcome;
  reason: string | null;
  provider: string | null;
  model: string | null;
  instrumentHint: string | null;
  lastFourHint: string | null;
  accountNumberHint: string | null;
  extractedPayload: unknown;
  createdAt: Date;
  source: { institutionId: string; institution: { name: string } };
  transaction: { id: string } | null;
}

export interface PersistFinancialCandidate {
  userId: string;
  sourceId: string;
  sourceReference: string;
  outcome: EmailMessageOutcome;
  reason?: string | null;
  provider?: string | null;
  model?: string | null;
  instrumentHint?: string | null;
  lastFourHint?: string | null;
  accountNumberHint?: string | null;
  extractedPayload?: unknown;
}

export type AssignFinancialCandidateCommand = {
  accountId?: string;
  cardId?: string;
  amount?: number;
};

/**
 * No persistence adapter or worker is registered during AI-0. Fixtures exercise
 * the preserved rules; FIN-3 supplies normalized financial candidates.
 * Every persistence operation must be scoped to the verified actor.
 */
export abstract class FinancialImportCandidatesPort {
  abstract listPendingAssignmentCandidates(
    userId: string,
  ): Promise<FinancialImportCandidate[]>;
  abstract listPendingAssignmentCandidatesPage(
    userId: string,
    query: CursorQueryDto,
  ): Promise<FinancialImportCandidate[]>;
  abstract listRecentCandidatesPage(
    userId: string,
    query: CursorQueryDto,
  ): Promise<FinancialImportCandidate[]>;
  abstract findCandidateById(
    userId: string,
    id: string,
  ): Promise<FinancialImportCandidate | null>;
  abstract listPendingReversalCandidates(
    userId: string,
    limit: number,
  ): Promise<FinancialImportCandidate[]>;
  abstract persistCandidate(
    input: PersistFinancialCandidate,
  ): Promise<{ id: string }>;
  abstract listInstitutionDestinations(
    userId: string,
    institutionId: string,
  ): Promise<
    [
      Array<{
        id: string;
        accountNumberLast4: string | null;
        isDefaultForInstitution?: boolean;
      }>,
      Array<{ id: string; lastFour: string | null }>,
    ]
  >;
  abstract listCategories(
    userId: string,
  ): Promise<Array<{ id: string; name: string; type: string }>>;
  abstract listCashAccounts(userId: string): Promise<Array<{ id: string }>>;
  abstract listMovementsForTransferMatch(
    userId: string,
    since: Date,
  ): Promise<EmailMatchCandidate[]>;
  abstract findImportMode(userId: string): Promise<'DIRECT' | 'PENDING'>;
  abstract findFixedIncomeAmount(userId: string): Promise<number | null>;
  abstract findSuggestedPayrollAmount(input: {
    userId: string;
    accountId: string;
    currency: string;
  }): Promise<number | null>;
}
