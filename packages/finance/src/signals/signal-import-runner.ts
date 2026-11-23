import { Injectable } from '@nestjs/common';
import type { RoutedSignal } from '@personal-os/contracts';
import type {
  ImportResolutionOverride,
  SignalConsumeResult,
} from './signal-import-plan';
import { SignalImportExecutor } from './signal-import-executor';
import { SignalImportRunLock } from './signal-import-run-lock';
import { SignalImportPlanner } from './signal-import-planner';

type ImportResolution = {
  signal: RoutedSignal;
  override: ImportResolutionOverride;
};

type ImportRun = {
  signal: RoutedSignal;
  override?: ImportResolutionOverride;
};

/** Consumes signals: lock if needed, plan, then apply. */
@Injectable()
export class SignalImportRunner {
  constructor(
    private readonly lock: SignalImportRunLock,
    private readonly planner: SignalImportPlanner,
    private readonly executor: SignalImportExecutor,
  ) {}

  consume(signal: RoutedSignal): Promise<SignalConsumeResult> {
    return this.run({ signal });
  }

  consumeResolved({
    signal,
    override,
  }: ImportResolution): Promise<SignalConsumeResult> {
    return this.run({ signal, override });
  }

  private run({ signal, override }: ImportRun): Promise<SignalConsumeResult> {
    return this.lock.run({
      signal,
      override,
      importPlan: (lockHeld) =>
        this.importSignal({ signal, override, lockHeld }),
    });
  }

  private async importSignal({
    signal,
    override,
    lockHeld,
  }: ImportRun & {
    lockHeld: boolean;
  }): Promise<SignalConsumeResult> {
    const plan = await this.planner.build({ signal, override });
    return this.executor.execute({ signal, plan, lockHeld });
  }
}
