import { Injectable } from '@nestjs/common';
import type { RoutedSignal } from '@personal-os/contracts';
import { LedgerQueryService } from '../ledger/application/ledger-query.service';
import type { TransferLegIdentity } from '../ledger/application/resolve-transfer-import';
import {
  duplicatePlan,
  reviewPlan,
  type ImportPlan,
} from './signal-import-plan';
import type { SignalCandidate } from './signal-import-payload';
import { SignalImportTargets } from './signal-import-targets';

type MovementDuplicateInput = {
  signal: RoutedSignal;
  candidate: SignalCandidate;
  type: 'DEBIT' | 'CREDIT';
  amount: number;
  currency: string;
  transactionDate: Date;
  transfer: boolean;
  transferLeg: TransferLegIdentity | null;
  target: { accountId?: string; cardId?: string };
};

/** Duplicate or shared reference a movement plan would collide with. */
@Injectable()
export class SignalMovementDuplicate {
  constructor(
    private readonly targets: SignalImportTargets,
    private readonly ledger: LedgerQueryService,
  ) {}

  async resolve({
    signal,
    candidate,
    type,
    amount,
    currency,
    transactionDate,
    transfer,
    transferLeg,
    target,
  }: MovementDuplicateInput): Promise<ImportPlan | null> {
    if (
      transfer &&
      transferLeg &&
      target.accountId &&
      candidate.bankReference
    ) {
      const decision = await this.targets.classifyAgainstSharedReference({
        userId: signal.userId,
        bankReference: candidate.bankReference,
        incoming: {
          type: transferLeg.type,
          accountId: target.accountId,
          amount,
          currency,
          transactionDate,
        },
      });
      if (decision.kind === 'duplicate') {
        return duplicatePlan(decision.transactionId);
      }
      if (decision.kind === 'conflict') {
        return reviewPlan(decision.reason, {
          externalReference: candidate.bankReference,
          candidateTransactionIds: decision.candidateTransactionIds,
        });
      }
      return null;
    }
    const duplicate = await this.ledger.findDedupeCandidate(signal.userId, {
      externalReference: candidate.bankReference ?? null,
      accountId: target.accountId,
      cardId: target.cardId,
      amount,
      currency,
      type,
      merchant: candidate.merchant ?? null,
      transactionDate,
    });
    return duplicate ? duplicatePlan(duplicate.id) : null;
  }
}
