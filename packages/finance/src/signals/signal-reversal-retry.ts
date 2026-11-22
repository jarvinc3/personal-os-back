import { Logger } from '@nestjs/common';
import type { RoutedSignal } from '@personal-os/contracts';
import type { PrismaService } from '@personal-os/database';
import type { SignalImportApplier } from './signal-import-applier';
import {
  FINANCE_TRANSACTION_SIGNAL,
  parseSignalPayload,
  type SignalCandidate,
} from './signal-import-payload';
import {
  lockSignalImports,
  SIGNAL_IMPORT_TRANSACTION_MAX_WAIT_MS,
  SIGNAL_IMPORT_TRANSACTION_TIMEOUT_MS,
} from './signal-import-lock';
import type {
  PendingReversalRow,
  SignalImportStore,
} from './signal-import-store';
import type { SignalReversalPlanner } from './signal-reversal-planner';

/** Reintenta los reversos en revisión cuando un import nuevo trae su original. */
export class PendingReversalRetry {
  private readonly logger = new Logger(PendingReversalRetry.name);

  constructor(
    private readonly deps: {
      prisma: PrismaService;
      store: SignalImportStore;
      planner: SignalReversalPlanner;
      applier: SignalImportApplier;
    },
  ) {}

  async run({
    userId,
    lockHeld,
  }: {
    userId: string;
    lockHeld: boolean;
  }): Promise<void> {
    const pending = await this.deps.store.findPendingReversalRows(userId);
    for (const row of pending) {
      try {
        await this.applyPending({ userId, row, lockHeld });
      } catch (error) {
        const code = (error as { code?: string }).code ?? 'UNKNOWN';
        this.logger.warn(
          { signalId: row.signalId, code },
          'Reversal retry failed',
        );
      }
    }
  }

  /**
   * El reintento comparte el bloqueo por usuario con la resolución humana y el
   * descarte. Si el import ya salió de revisión, no se aplica ningún cambio.
   * Cuando quien llama ya tiene el bloqueo, no se vuelve a pedir: pedirlo en
   * otra conexión dentro de la misma transacción lo dejaría esperándose a sí
   * mismo.
   */
  private async applyPending({
    userId,
    row,
    lockHeld,
  }: {
    userId: string;
    row: PendingReversalRow;
    lockHeld: boolean;
  }): Promise<void> {
    const candidate = parseSignalPayload(row.candidate)?.transaction ?? null;
    if (!candidate) {
      return;
    }
    const signal = this.pendingSignal(userId, row);
    if (lockHeld) {
      await this.applyRetry({ userId, signal, candidate });
      return;
    }
    await this.deps.prisma.$transaction(
      async (tx) => {
        await lockSignalImports({ tx, userId });
        await this.applyRetry({ userId, signal, candidate });
      },
      {
        timeout: SIGNAL_IMPORT_TRANSACTION_TIMEOUT_MS,
        maxWait: SIGNAL_IMPORT_TRANSACTION_MAX_WAIT_MS,
      },
    );
  }

  private async applyRetry({
    userId,
    signal,
    candidate,
  }: {
    userId: string;
    signal: RoutedSignal;
    candidate: SignalCandidate;
  }): Promise<void> {
    const current = await this.deps.store.findStatus({
      userId,
      signalId: signal.signalId,
    });
    if (current !== 'REVIEW_REQUIRED') {
      return;
    }
    const plan = await this.deps.planner.build({ signal, candidate });
    if (plan.kind !== 'IMPORT') {
      await this.deps.applier.apply(signal, plan);
      return;
    }
    // Un reverso parcial es el único plan que escribe un movimiento aquí: lleva
    // su original enlazado y no es transferencia, así que no quedan reintento
    // ni emparejamiento pendientes.
    await this.deps.applier.applyImport(signal, plan.draft);
  }

  private pendingSignal(
    userId: string,
    row: {
      signalId: string;
      sourceEmailMessageId: string;
      createdAt: Date;
    },
  ): RoutedSignal {
    return {
      signalId: row.signalId,
      userId,
      signalType: FINANCE_TRANSACTION_SIGNAL,
      schemaVersion: 1,
      occurredAt: row.createdAt.toISOString(),
      sourceType: 'EMAIL_MESSAGE',
      sourceId: row.sourceEmailMessageId,
      payload: {},
    };
  }
}
