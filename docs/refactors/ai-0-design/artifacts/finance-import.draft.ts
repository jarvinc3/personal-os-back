// Finance-owned draft. This must NOT live in the generic contracts package.
// AI-0 mechanically renames identifiers; financial arithmetic stays unchanged.
export type ImportedMovementCommand = {
  accountId?: string;
  cardId?: string;
  importReference: string;
  externalReference?: string | null;
  amount: number;
  currency: string;
  merchant: string | null;
  merchantId?: string | null;
  description: string;
  notes?: string | null;
  transactionDate: Date;
  categoryId?: string | null;
  type?: 'DEBIT' | 'CREDIT';
  transferGroupId?: string | null;
  status: 'PENDING' | 'CONFIRMED' | 'DECLINED' | 'CANCELLED' | 'REVERSED';
  aiMetadata?: unknown;
};

export interface PendingFinancialCandidate {
  id: string;
  userId: string;
  importReference: string;
  institutionId: string | null;
  state: 'PENDING_ASSIGNMENT' | 'PENDING_AMOUNT' | 'PENDING_REVERSE';
  extracted: Readonly<Record<string, unknown>>;
}

// No implementation/worker is registered until the signal consumer exists.
// Preserved reverse/backfill algorithms use fixtures implementing this port.
export interface PendingFinancialCandidatesPort {
  list(
    userId: string,
    state: PendingFinancialCandidate['state'],
    limit: number,
  ): Promise<readonly PendingFinancialCandidate[]>;
  find(userId: string, id: string): Promise<PendingFinancialCandidate | null>;
  recordOutcome(
    userId: string,
    id: string,
    outcome: 'APPLIED' | 'REJECTED',
    transactionIds: readonly string[],
  ): Promise<void>;
}
