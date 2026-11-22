import type { RoutedSignal } from '@personal-os/contracts';
import type { LedgerQueryService } from '../ledger/application/ledger-query.service';
import {
  isCardPaymentMovementClass,
  isTransferMovementClass,
  type MovementClass,
} from '../ledger/domain/movement-class';
import type { FinTransactionStatusValue } from '../shared/domain/transaction-status';
import type { CardPaymentPlanner } from './signal-card-payment-planner';
import {
  failedPlan,
  importedPlan,
  returnPlan,
  reviewPlan,
  storedImportResult,
  type ImportPlan,
  type ImportResolutionOverride,
} from './signal-import-plan';
import {
  FINANCE_TRANSACTION_SIGNAL,
  firstValidationReviewReason,
  parseSignalPayload,
  resolveImportStatus,
  resolveMovementClass,
  resolveTransactionType,
  withResolvedTransactionDate,
  type SignalCandidate,
  type SignalPayload,
} from './signal-import-payload';
import {
  isRetryableTargetReview,
  type SignalImportStore,
} from './signal-import-store';
import type { SignalImportTargets } from './signal-import-targets';
import type { SignalMovementPlanner } from './signal-movement-planner';
import type { SignalReversalPlanner } from './signal-reversal-planner';

const REVIEW_CONFIDENCE_THRESHOLD = 0.7;

type ImportRequest = {
  signal: RoutedSignal;
  override?: ImportResolutionOverride;
};

/** Lo que el plan de movimiento necesita, ya validado y clasificado. */
type PreparedMovement = {
  kind: 'movement';
  payload: SignalPayload;
  candidate: SignalCandidate;
  movementClass: MovementClass;
  type: 'DEBIT' | 'CREDIT';
  status: FinTransactionStatusValue;
  amount: number;
  currency: string;
  transactionDate: Date;
};

type PreparedImport = PreparedMovement | { kind: 'plan'; plan: ImportPlan };

/** Decide qué pasará con la señal antes de escribir nada en el ledger. */
export class SignalImportPlanner {
  constructor(
    private readonly deps: {
      store: SignalImportStore;
      ledger: LedgerQueryService;
      targets: SignalImportTargets;
      movementPlanner: SignalMovementPlanner;
      reversalPlanner: SignalReversalPlanner;
      cardPaymentPlanner: CardPaymentPlanner;
    },
  ) {}

  async build({ signal, override }: ImportRequest): Promise<ImportPlan> {
    if (signal.signalType !== FINANCE_TRANSACTION_SIGNAL) {
      return returnPlan({
        outcome: 'REJECTED',
        domainReferences: [],
        reason: 'UNSUPPORTED_FINANCE_SIGNAL',
      });
    }

    const blockedPlan = await this.blockedPlan({ signal, override });
    if (blockedPlan) {
      return blockedPlan;
    }

    const prepared = this.prepare({ signal, override });
    if (prepared.kind === 'plan') {
      return prepared.plan;
    }
    const accounts = await this.deps.targets.findActiveAccounts(signal.userId);
    const cards = await this.deps.targets.findActiveCards(signal.userId);
    if (prepared.status === 'REVERSED') {
      return this.deps.reversalPlanner.build({
        signal,
        candidate: prepared.candidate,
        originalTransactionId: override?.originalTransactionId,
      });
    }
    if (isCardPaymentMovementClass(prepared.movementClass)) {
      return this.deps.cardPaymentPlanner.build({
        signal,
        payload: prepared.payload,
        candidate: prepared.candidate,
        accounts,
        status: prepared.status,
        cardId: override?.destination?.cardId,
        sourceAccountId: override?.destination?.accountId,
      });
    }
    return this.deps.movementPlanner.plan({
      signal,
      payload: prepared.payload,
      candidate: prepared.candidate,
      movementClass: prepared.movementClass,
      type: prepared.type,
      status: prepared.status,
      amount: prepared.amount,
      currency: prepared.currency,
      transactionDate: prepared.transactionDate,
      accounts,
      cards,
      override,
    });
  }

  /**
   * Una señal ya resuelta no se vuelve a escribir: devuelve el estado guardado.
   * La referencia del import manda sobre cualquier cálculo nuevo.
   */
  private async blockedPlan({
    signal,
    override,
  }: ImportRequest): Promise<ImportPlan | null> {
    const prior = await this.deps.store.findPriorImport({
      userId: signal.userId,
      signalId: signal.signalId,
    });
    if (!override && prior && !isRetryableTargetReview(prior)) {
      return returnPlan(
        storedImportResult({
          status: prior.status,
          reason: prior.reviewReason,
          transactionId: prior.transactionId ?? prior.duplicateOfTransactionId,
        }),
      );
    }
    const existingTransaction =
      await this.deps.ledger.findTransactionByImportReference(
        signal.signalId,
        signal.userId,
      );
    return existingTransaction ? importedPlan(existingTransaction.id) : null;
  }

  private prepare({ signal, override }: ImportRequest): PreparedImport {
    const payload = parseSignalPayload(signal.payload);
    if (!payload) {
      return { kind: 'plan', plan: failedPlan('INVALID_SIGNAL_PAYLOAD') };
    }
    const candidate = withResolvedTransactionDate({
      candidate: payload.transaction,
      transactionDate: override?.transactionDate,
    });
    if (!candidate || candidate.kind === 'NOT_TRANSACTION') {
      return { kind: 'plan', plan: failedPlan('NO_TRANSACTION_CANDIDATE') };
    }
    if (isLowConfidence(payload)) {
      return {
        kind: 'plan',
        plan: reviewPlan('LOW_CONFIDENCE_OR_NOT_FINANCE'),
      };
    }
    const validationPlan = this.validationPlan(candidate);
    if (validationPlan) {
      return { kind: 'plan', plan: validationPlan };
    }
    const movementClass = resolveMovementClass(candidate);
    const directionPlan = transferDirectionPlan(candidate, movementClass);
    if (directionPlan) {
      return { kind: 'plan', plan: directionPlan };
    }
    return {
      kind: 'movement',
      payload,
      candidate,
      movementClass,
      type: resolveTransactionType(candidate, movementClass),
      status: resolveImportStatus({ payload, candidate }),
      amount: candidate.amount!,
      currency: candidate.currency!,
      transactionDate: new Date(candidate.transactionDate!),
    };
  }

  private validationPlan(candidate: SignalCandidate): ImportPlan | null {
    const reason = firstValidationReviewReason(candidate);
    if (!reason) {
      return null;
    }
    if (reason !== 'TRANSACTION_DATE_SUGGESTED') {
      return reviewPlan(reason);
    }
    return reviewPlan(reason, {
      suggestedTransactionDate: candidate.suggestedTransactionDate ?? null,
      suggestedTransactionDateSource:
        candidate.suggestedTransactionDateSource ?? null,
    });
  }
}

function isLowConfidence(payload: SignalPayload): boolean {
  if (payload.relevance === false) {
    return true;
  }
  if (!payload.routes?.includes('FINANCE')) {
    return true;
  }
  return (payload.confidence ?? 0) < REVIEW_CONFIDENCE_THRESHOLD;
}

function transferDirectionPlan(
  candidate: SignalCandidate,
  movementClass: MovementClass,
): ImportPlan | null {
  if (
    candidate.direction === 'TRANSFER' &&
    !isTransferMovementClass(movementClass)
  ) {
    return reviewPlan('TRANSFER_DIRECTION_AMBIGUOUS');
  }
  if (isTransferMovementClass(movementClass) && !candidate.direction) {
    return reviewPlan('TRANSFER_SIDE_MISSING');
  }
  return null;
}
