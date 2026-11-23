import { Injectable } from '@nestjs/common';
import type { RoutedSignal } from '@personal-os/contracts';
import type { SignalCandidate } from './signal-import-payload';
import { SignalImportStore } from './signal-import-store';
import { SignalReversalPlanner } from './signal-reversal-planner';
import { SignalReversalRetryWriter } from './signal-reversal-retry-writer';

type RetryApply = {
  userId: string;
  signal: RoutedSignal;
  candidate: SignalCandidate;
};

/** Builds and writes the retry of one pending reversal, if still in review. */
@Injectable()
export class SignalReversalRetryApply {
  constructor(
    private readonly store: SignalImportStore,
    private readonly planner: SignalReversalPlanner,
    private readonly writer: SignalReversalRetryWriter,
  ) {}

  async apply({ userId, signal, candidate }: RetryApply): Promise<void> {
    const current = await this.store.findStatus({
      userId,
      signalId: signal.signalId,
    });
    if (current !== 'REVIEW_REQUIRED') {
      return;
    }
    const plan = await this.planner.build({ signal, candidate });
    await this.writer.write({ signal, plan });
  }
}
