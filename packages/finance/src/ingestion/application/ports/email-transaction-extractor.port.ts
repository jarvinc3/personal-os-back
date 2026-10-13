import type { BankStatusNormalized } from '../../../shared/domain/transaction-status';
import type { EmailMovementClass } from '../email-movement';

export type ExtractedEmailTransaction = {
  amount: number | null;
  currency: string;
  type: 'DEBIT' | 'CREDIT';
  transactionDate: string; // ISO
  merchant: string | null;
  description: string;
  notes: string | null;
  movementClass: EmailMovementClass;
  categoryNameHint: string | null;
  bankStatusRaw: string | null;
  bankStatusNormalized: BankStatusNormalized;
  statusEvidence: string;
  statusConfidence: number;
  bankReference: string | null;
  reverseOfEmailMessageId: string | null;
  reverseOriginalRef: string | null;
  instrumentHint: 'ACCOUNT' | 'CARD' | null;
  lastFourHint: string | null;
  accountNumberHint: string | null;
};

export type EmailExtractionCategory = {
  name: string;
  type: 'EXPENSE' | 'INCOME' | (string & {});
};

export type EmailExtractionInput = {
  from: string;
  subject: string;
  body: string;
  bankDomain: string;
  categories?: EmailExtractionCategory[];
  /** Gmail internal date, used when the body has no date of its own. */
  receivedAt?: string;
};

export type EmailExtractionResult =
  | {
      ok: true;
      kind: 'transaction';
      data: ExtractedEmailTransaction;
      provider: string;
      model: string;
    }
  | {
      ok: true;
      kind: 'pending_amount';
      data: ExtractedEmailTransaction;
      provider: string;
      model: string;
    }
  | {
      ok: true;
      kind: 'not_transaction';
      reason: string;
      provider: string;
      model: string;
    }
  | { ok: false; reason: string; retryable: boolean };

export interface EmailTransactionExtractorPort {
  extract(input: EmailExtractionInput): Promise<EmailExtractionResult>;
}
