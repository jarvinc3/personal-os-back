import { Injectable } from '@nestjs/common';
import type { RoutedSignal } from '@personal-os/contracts';
import {
  buildConsumeResult,
  type ImportDraft,
  type ImportPlan,
  type SignalConsumeResult,
} from './signal-import-plan';
import { SignalImportApplier } from './signal-import-applier';
import { SignalImportFollowUps } from './signal-import-follow-ups';
import { SignalImportMovementWriter } from './signal-import-movement-writer';

type PlanExecution = {
  signal: RoutedSignal;
  plan: ImportPlan;
  lockHeld: boolean;
};

/** Applies a plan and the follow-ups it enables. */
@Injectable()
export class SignalImportExecutor {
  constructor(
    private readonly movementWriter: SignalImportMovementWriter,
    private readonly applier: SignalImportApplier,
    private readonly followUps: SignalImportFollowUps,
  ) {}

  async execute({
    signal,
    plan,
    lockHeld,
  }: PlanExecution): Promise<SignalConsumeResult> {
    const consumeResult = await this.applyPlan({ signal, plan, lockHeld });
    await this.followUps.afterPlan({ signal, consumeResult });
    return consumeResult;
  }

  private applyPlan({
    signal,
    plan,
    lockHeld,
  }: PlanExecution): Promise<SignalConsumeResult> {
    if (plan.kind === 'IMPORT') {
      return this.importMovement({ signal, draft: plan.draft, lockHeld });
    }
    return this.applier.apply(signal, plan);
  }

  /**
   * Un movimiento nuevo habilita dos pasos que solo él puede decidir: reintentar
   * los reversos que esperaban su original y emparejar la pata de una
   * transferencia.
   */
  private async importMovement({
    signal,
    draft,
    lockHeld,
  }: {
    signal: RoutedSignal;
    draft: ImportDraft;
    lockHeld: boolean;
  }): Promise<SignalConsumeResult> {
    const outcome = await this.movementWriter.applyImport(signal, draft);
    if (outcome.kind === 'DONE') {
      return outcome.consumeResult;
    }
    await this.followUps.afterMovement({
      signal,
      draft,
      lockHeld,
      transactionId: outcome.transactionId,
    });
    return buildConsumeResult('APPLIED', outcome.transactionId);
  }
}
