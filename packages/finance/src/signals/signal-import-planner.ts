import { Injectable } from '@nestjs/common';
import type { RoutedSignal } from '@personal-os/contracts';
import {
  isTransferMovementClass,
  type MovementClass,
} from '../ledger/domain/movement-class';
import type { FinTransactionStatusValue } from '../shared/domain/transaction-status';
import type {
  ImportPlan,
  ImportResolutionOverride,
} from './signal-import-plan';
import { failedPlan, returnPlan, reviewPlan } from './signal-import-plan';
import { SignalImportPlanGuard } from './signal-import-plan-guard';
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
import { SignalImportTargets } from './signal-import-targets';
import { SignalPlanDispatch } from './signal-plan-dispatch';

const REVIEW_CONFIDENCE_THRESHOLD = 0.7;

type ImportRequest = {
  signal: RoutedSignal;
  override?: ImportResolutionOverride;
};

/** Lo que el plan de movimiento necesita, ya validado y clasificado. */
export type PreparedMovement = {
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
@Injectable()
export class SignalImportPlanner {
  constructor(
    private readonly guard: SignalImportPlanGuard,
    private readonly targets: SignalImportTargets,
    private readonly dispatch: SignalPlanDispatch,
  ) {}

  async build({ signal, override }: ImportRequest): Promise<ImportPlan> {
    if (signal.signalType !== FINANCE_TRANSACTION_SIGNAL) {
      return returnPlan({
        outcome: 'REJECTED',
        domainReferences: [],
        reason: 'UNSUPPORTED_FINANCE_SIGNAL',
      });
    }

    const blockedPlan = await this.guard.blockedPlan({ signal, override });
    if (blockedPlan) {
      return blockedPlan;
    }

    const prepared = this.prepare({ signal, override });
    if (prepared.kind === 'plan') {
      return prepared.plan;
    }
    const accounts = await this.targets.findActiveAccounts(signal.userId);
    const cards = await this.targets.findActiveCards(signal.userId);
    return this.dispatch.decide({
      prepared,
      signal,
      accounts,
      cards,
      override,
    });
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
