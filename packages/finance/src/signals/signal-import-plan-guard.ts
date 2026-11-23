import { Injectable } from '@nestjs/common';
import type { RoutedSignal } from '@personal-os/contracts';
import { LedgerQueryService } from '../ledger/application/ledger-query.service';
import {
  importedPlan,
  returnPlan,
  storedImportResult,
  type ImportPlan,
  type ImportResolutionOverride,
} from './signal-import-plan';
import {
  isRetryableTargetReview,
  SignalImportStore,
} from './signal-import-store';

type GuardRequest = {
  signal: RoutedSignal;
  override?: ImportResolutionOverride;
};

/** A signal already resolved is returned as stored instead of planned again. */
@Injectable()
export class SignalImportPlanGuard {
  constructor(
    private readonly store: SignalImportStore,
    private readonly ledger: LedgerQueryService,
  ) {}

  async blockedPlan({
    signal,
    override,
  }: GuardRequest): Promise<ImportPlan | null> {
    const prior = await this.store.findPriorImport({
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
      await this.ledger.findTransactionByImportReference(
        signal.signalId,
        signal.userId,
      );
    return existingTransaction ? importedPlan(existingTransaction.id) : null;
  }
}
