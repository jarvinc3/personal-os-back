import type { RoutedSignal } from '@personal-os/contracts';
import type { ImportCardPaymentInput } from '../ledger/application/import-card-payment.use-case';
import type { ImportFinancialMovementInput } from '../ledger/application/import-financial-transaction.use-case';
import type { MovementClass } from '../ledger/domain/movement-class';
import type { SignalCandidate, SignalPayload } from './signal-import-payload';

export type ImportStatus =
  | 'IMPORTED'
  | 'DUPLICATE'
  | 'REVERSED'
  | 'REVIEW_REQUIRED'
  | 'FAILED'
  | 'DISMISSED';

export type ImportOutcome =
  'APPLIED' | 'ALREADY_APPLIED' | 'REVIEW_REQUIRED' | 'REJECTED';

export type ImportReviewEvidence = Record<
  string,
  string | string[] | number | null
>;

export type SignalConsumeResult = {
  outcome: ImportOutcome;
  domainReferences: readonly { type: string; id: string }[];
  reason?: string;
};

/**
 * Lo que la importación escribiría. Se calcula solo con lecturas, así la vista
 * previa y la ejecución parten de la misma decisión.
 */
export type ImportDraft = {
  input: ImportFinancialMovementInput;
  cashAccountId: string | null;
  transfer: boolean;
};

export type ImportPlan =
  | { kind: 'RETURN'; consumeResult: SignalConsumeResult }
  | {
      kind: 'RECORD';
      status: ImportStatus;
      consumeResult: SignalConsumeResult;
      reason?: string;
      transactionId?: string | null;
      duplicateOfTransactionId?: string | null;
      evidence?: ImportReviewEvidence;
    }
  | { kind: 'REVERSE'; originalId: string; metadata: Record<string, unknown> }
  | { kind: 'CARD_PAYMENT'; payment: ImportCardPaymentInput }
  | { kind: 'IMPORT'; draft: ImportDraft };

/**
 * Decisión humana sobre un import en revisión. La fecha, el destino o el
 * original elegidos sustituyen lo que el correo no permitía decidir; el resto
 * del plan se calcula igual que en la importación automática.
 */
export type ImportResolutionOverride = {
  transactionDate?: Date;
  destination?: { accountId?: string; cardId?: string };
  originalTransactionId?: string;
};

export type SignalImportMetadata = {
  signalId: string;
  sourceEmailMessageId: string;
  signalType: string;
  signalSchemaVersion: number;
  semanticType: string | null;
  confidence: number | null;
  movementClass: MovementClass;
  bankStatusNormalized: string;
  statusConfidence: number;
  statusEvidence: string | null;
  suggestedTransactionDate: string | null;
  suggestedTransactionDateSource: string | null;
  originalAmount: number;
  originalCurrency: string;
  sourceReceivedAmount: number | null;
  sourceExchangeRate: number | null;
};

export function buildConsumeResult(
  outcome: 'APPLIED' | 'ALREADY_APPLIED',
  transactionId: string | null,
): SignalConsumeResult {
  return {
    outcome,
    domainReferences: transactionId
      ? [{ type: 'FinTransaction', id: transactionId }]
      : [],
  };
}

export function returnPlan(consumeResult: SignalConsumeResult): ImportPlan {
  return { kind: 'RETURN', consumeResult };
}

export function importedPlan(transactionId: string): ImportPlan {
  return {
    kind: 'RECORD',
    status: 'IMPORTED',
    transactionId,
    consumeResult: buildConsumeResult('ALREADY_APPLIED', transactionId),
  };
}

export function duplicatePlan(
  transactionId: string,
  evidence?: ImportReviewEvidence,
): ImportPlan {
  return {
    kind: 'RECORD',
    status: 'DUPLICATE',
    duplicateOfTransactionId: transactionId,
    evidence,
    consumeResult: buildConsumeResult('ALREADY_APPLIED', transactionId),
  };
}

export function failedPlan(reason: string): ImportPlan {
  return {
    kind: 'RECORD',
    status: 'FAILED',
    reason,
    consumeResult: { outcome: 'REJECTED', domainReferences: [], reason },
  };
}

export function reviewPlan(
  reason: string,
  evidence?: ImportReviewEvidence,
): ImportPlan {
  return {
    kind: 'RECORD',
    status: 'REVIEW_REQUIRED',
    reason,
    evidence,
    consumeResult: { outcome: 'REVIEW_REQUIRED', domainReferences: [], reason },
  };
}

export function storedImportResult({
  status,
  reason,
  transactionId,
}: {
  status: ImportStatus;
  reason: string | null;
  transactionId: string | null;
}): SignalConsumeResult {
  if (status === 'REVIEW_REQUIRED') {
    return {
      outcome: 'REVIEW_REQUIRED',
      domainReferences: [],
      reason: reason ?? 'REVIEW_REQUIRED',
    };
  }
  if (status === 'FAILED') {
    return {
      outcome: 'REJECTED',
      domainReferences: [],
      reason: reason ?? 'SIGNAL_IMPORT_FAILED',
    };
  }
  if (status === 'DISMISSED') {
    return {
      outcome: 'REJECTED',
      domainReferences: [],
      reason: 'IMPORT_DISMISSED_BY_USER',
    };
  }
  return buildConsumeResult('ALREADY_APPLIED', transactionId);
}

export function buildSignalImportMetadata({
  signal,
  payload,
  candidate,
  movementClass,
  amount,
  currency,
}: {
  signal: RoutedSignal;
  payload: SignalPayload;
  candidate: SignalCandidate;
  movementClass: MovementClass;
  amount: number;
  currency: string;
}): SignalImportMetadata {
  return {
    signalId: signal.signalId,
    sourceEmailMessageId: signal.sourceId,
    signalType: signal.signalType,
    signalSchemaVersion: signal.schemaVersion,
    semanticType: payload.semanticType ?? null,
    confidence: payload.confidence ?? null,
    movementClass,
    bankStatusNormalized: candidate.bankStatusNormalized ?? 'UNKNOWN',
    statusConfidence: candidate.statusConfidence ?? payload.confidence ?? 0,
    statusEvidence: candidate.statusEvidence ?? null,
    suggestedTransactionDate: candidate.suggestedTransactionDate ?? null,
    suggestedTransactionDateSource:
      candidate.suggestedTransactionDateSource ?? null,
    originalAmount: amount,
    originalCurrency: currency,
    sourceReceivedAmount: candidate.receivedAmount ?? null,
    sourceExchangeRate: candidate.transferExchangeRate ?? null,
  };
}
