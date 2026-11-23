import { Injectable } from '@nestjs/common';
import type { RoutedSignal } from '@personal-os/contracts';
import type { ImportPlan } from './signal-import-plan';
import { SignalImportApplier } from './signal-import-applier';
import { SignalImportMovementWriter } from './signal-import-movement-writer';

type RetryWrite = {
  signal: RoutedSignal;
  plan: ImportPlan;
};

/** Writes a retry plan: a movement writer or the stored/reversal applier. */
@Injectable()
export class SignalReversalRetryWriter {
  constructor(
    private readonly movementWriter: SignalImportMovementWriter,
    private readonly applier: SignalImportApplier,
  ) {}

  async write({ signal, plan }: RetryWrite): Promise<void> {
    if (plan.kind !== 'IMPORT') {
      await this.applier.apply(signal, plan);
      return;
    }
    // Un reverso parcial es el único plan que escribe un movimiento aquí: lleva
    // su original enlazado y no es transferencia, así que no quedan reintento
    // ni emparejamiento pendientes.
    await this.movementWriter.applyImport(signal, plan.draft);
  }
}
