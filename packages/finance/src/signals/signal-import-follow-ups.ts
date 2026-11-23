import { Injectable } from '@nestjs/common';
import type { RoutedSignal } from '@personal-os/contracts';
import { isTransferMovementClass } from '../ledger/domain/movement-class';
import type { ImportDraft, SignalConsumeResult } from './signal-import-plan';
import { parseSignalPayload } from './signal-import-payload';
import { PendingReversalRetry } from './signal-reversal-retry';
import { TransferPairing } from './signal-transfer-pairing';

type PlanFollowUp = {
  signal: RoutedSignal;
  consumeResult: SignalConsumeResult;
};

type MovementFollowUp = {
  signal: RoutedSignal;
  draft: ImportDraft;
  lockHeld: boolean;
  transactionId: string;
};

/** Steps a plan enables after writing: reversal retry and transfer pairing. */
@Injectable()
export class SignalImportFollowUps {
  constructor(
    private readonly reversalRetry: PendingReversalRetry,
    private readonly pairing: TransferPairing,
  ) {}

  async afterPlan({ signal, consumeResult }: PlanFollowUp): Promise<void> {
    if (
      consumeResult.outcome !== 'ALREADY_APPLIED' ||
      !this.isTransferSignal(signal)
    ) {
      return;
    }
    const transactionId = consumeResult.domainReferences[0]?.id;
    if (transactionId) {
      await this.pairing.pair(signal.userId, transactionId);
    }
  }

  async afterMovement({
    signal,
    draft,
    lockHeld,
    transactionId,
  }: MovementFollowUp): Promise<void> {
    if (!draft.input.linkedTransactionId && !draft.transfer) {
      await this.reversalRetry.run({ userId: signal.userId, lockHeld });
    }
    if (draft.transfer) {
      await this.pairing.pair(signal.userId, transactionId);
    }
  }

  private isTransferSignal(signal: RoutedSignal): boolean {
    const payload = parseSignalPayload(signal.payload);
    return isTransferMovementClass(payload?.transaction?.movementClass);
  }
}
