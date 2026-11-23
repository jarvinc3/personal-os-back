import { Injectable } from '@nestjs/common';
import type { RoutedSignal } from '@personal-os/contracts';
import { PrismaService } from '@personal-os/database';
import {
  type ImportResolutionOverride,
  type SignalConsumeResult,
} from './signal-import-plan';
import {
  lockSignalImports,
  SIGNAL_IMPORT_TRANSACTION_MAX_WAIT_MS,
  SIGNAL_IMPORT_TRANSACTION_TIMEOUT_MS,
} from './signal-import-lock';
import { SignalImportStore } from './signal-import-store';

type LockedImport = {
  signal: RoutedSignal;
  override?: ImportResolutionOverride;
  importPlan: (lockHeld: boolean) => Promise<SignalConsumeResult>;
};

/** Runs an import with the user lock when a retryable review is pending. */
@Injectable()
export class SignalImportRunLock {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: SignalImportStore,
  ) {}

  async run({
    signal,
    override,
    importPlan,
  }: LockedImport): Promise<SignalConsumeResult> {
    if (override) {
      return importPlan(true);
    }
    const retryableReview = await this.store.findRetryableReviewPending({
      userId: signal.userId,
      signalId: signal.signalId,
    });
    if (!retryableReview) {
      return importPlan(false);
    }
    return this.prisma.$transaction(
      async (tx) => {
        await lockSignalImports({ tx, userId: signal.userId });
        return importPlan(true);
      },
      {
        timeout: SIGNAL_IMPORT_TRANSACTION_TIMEOUT_MS,
        maxWait: SIGNAL_IMPORT_TRANSACTION_MAX_WAIT_MS,
      },
    );
  }
}
