import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService, type Prisma } from '@personal-os/database';
import { FinanceSignalConsumer } from './finance-signal-consumer';
import {
  IMPORT_REVIEW_ACTION,
  type ImportReviewAction,
} from './import-review-actions';
import { ImportReviewAudit } from './import-review-audit';
import {
  ImportReviewDecision,
  type PreparedResolution,
  type ResolveImportReviewInput,
} from './import-review-decision';
import { ImportReviewQueue, type ReviewImportRow } from './import-review-queue';
import {
  lockSignalImports,
  SIGNAL_IMPORT_TRANSACTION_MAX_WAIT_MS,
  SIGNAL_IMPORT_TRANSACTION_TIMEOUT_MS,
} from './signal-import-lock';

export type { ResolveImportReviewInput } from './import-review-decision';

export type ImportReviewResolutionOutcome =
  | 'IMPORTED'
  | 'DUPLICATE'
  | 'REVERSED'
  | 'REVIEW_REQUIRED'
  | 'REJECTED'
  | 'DISMISSED';

export type ImportReviewResolution = {
  id: string;
  status: string;
  outcome: ImportReviewResolutionOutcome;
  transactionId: string | null;
  reviewReason: string | null;
};

type SignalConsumeOutcome =
  'APPLIED' | 'ALREADY_APPLIED' | 'REVIEW_REQUIRED' | 'REJECTED';

type ResolutionAttempt =
  | { kind: 'resolved'; resolution: ImportReviewResolution }
  | { kind: 'unresolved'; importId: string; reason: string | null };

/**
 * Vía humana para la cola de imports de correo en `REVIEW_REQUIRED`: fija la
 * fecha, el destino o el reverso original, o descarta el import. Cada decisión
 * se audita y solo escribe en el ledger cuando el plan de importación la aplica.
 *
 * La resolución y el descarte toman el mismo bloqueo por usuario, así que un
 * descarte no puede cruzarse con una resolución en curso.
 */
@Injectable()
export class ImportReviewResolutionService {
  private readonly queue: ImportReviewQueue;
  private readonly decision: ImportReviewDecision;
  private readonly audit: ImportReviewAudit;

  constructor(
    private readonly prisma: PrismaService,
    private readonly signals: FinanceSignalConsumer,
  ) {
    this.queue = new ImportReviewQueue(prisma);
    this.decision = new ImportReviewDecision();
    this.audit = new ImportReviewAudit(prisma);
  }

  listForUser(userId: string) {
    return this.queue.listForUser(userId);
  }

  async resolve({
    userId,
    importId,
    input,
  }: {
    userId: string;
    importId: string;
    input: ResolveImportReviewInput;
  }): Promise<ImportReviewResolution> {
    const attempt = await this.prisma.$transaction(
      async (tx) => {
        await lockSignalImports({ tx, userId });
        const reviewImport = await this.queue.loadOne({
          userId,
          importId,
          tx,
        });
        if (input.action === IMPORT_REVIEW_ACTION.DISCARD) {
          const resolution = await this.discard({
            userId,
            reviewImport,
            reason: input.reason,
            tx,
          });
          return { kind: 'resolved', resolution } satisfies ResolutionAttempt;
        }
        const prepared = await this.decision.prepare({ userId, input, tx });
        return this.applyResolution({
          userId,
          reviewImport,
          action: input.action,
          prepared,
          tx,
        });
      },
      {
        timeout: SIGNAL_IMPORT_TRANSACTION_TIMEOUT_MS,
        maxWait: SIGNAL_IMPORT_TRANSACTION_MAX_WAIT_MS,
      },
    );
    if (attempt.kind === 'unresolved') {
      throw new UnprocessableEntityException({
        message: 'El import sigue en revisión',
        importId: attempt.importId,
        reason: attempt.reason,
      });
    }
    return attempt.resolution;
  }

  private async applyResolution({
    userId,
    reviewImport,
    action,
    prepared,
    tx,
  }: {
    userId: string;
    reviewImport: ReviewImportRow;
    action: ImportReviewAction;
    prepared: PreparedResolution;
    tx: Prisma.TransactionClient;
  }): Promise<ResolutionAttempt> {
    const resolutionId = await this.audit.start({
      userId,
      signalImportId: reviewImport.id,
      action,
      changes: prepared.changes,
    });
    const consumeResult = await this.signals.consumeResolved({
      signal: this.queue.toRoutedSignal(reviewImport),
      override: prepared.override,
    });
    const updated = await tx.finSignalImport.findFirst({
      where: { id: reviewImport.id, userId },
      select: { status: true, transactionId: true, reviewReason: true },
    });
    if (!updated) {
      await this.audit.complete({
        userId,
        resolutionId,
        outcome: 'REJECTED',
        reason: 'IMPORT_NOT_FOUND',
      });
      throw new NotFoundException('Import en revisión no encontrado');
    }
    const outcome = outcomeOf({
      consumeResult,
      status: updated.status,
    });
    const reviewReason = consumeResult.reason ?? updated.reviewReason ?? null;
    await this.audit.complete({
      userId,
      resolutionId,
      outcome,
      reason: reviewReason,
    });
    if (outcome === 'REVIEW_REQUIRED' || outcome === 'REJECTED') {
      return {
        kind: 'unresolved',
        importId: reviewImport.id,
        reason: reviewReason,
      };
    }
    return {
      kind: 'resolved',
      resolution: {
        id: reviewImport.id,
        status: updated.status,
        outcome,
        transactionId: updated.transactionId,
        reviewReason: updated.reviewReason,
      },
    };
  }

  private async discard({
    userId,
    reviewImport,
    reason,
    tx,
  }: {
    userId: string;
    reviewImport: ReviewImportRow;
    reason?: string;
    tx: Prisma.TransactionClient;
  }): Promise<ImportReviewResolution> {
    const discardReason = readDiscardReason(reason);
    const updated = await tx.finSignalImport.updateMany({
      where: {
        id: reviewImport.id,
        userId,
        status: 'REVIEW_REQUIRED',
      },
      data: { status: 'DISMISSED' },
    });
    if (updated.count !== 1) {
      throw new ConflictException('El import ya no está en revisión');
    }
    await tx.finSignalImportResolution.create({
      data: {
        userId,
        signalImportId: reviewImport.id,
        actorUserId: userId,
        action: IMPORT_REVIEW_ACTION.DISCARD,
        outcome: 'DISMISSED',
        reason: discardReason,
        changes: { reason: discardReason },
      },
    });
    return {
      id: reviewImport.id,
      status: 'DISMISSED',
      outcome: 'DISMISSED',
      transactionId: null,
      reviewReason: null,
    };
  }
}

function readDiscardReason(reason?: string): string {
  const discardReason = reason?.trim() ?? '';
  if (discardReason.length === 0) {
    throw new BadRequestException('El descarte requiere un motivo');
  }
  return discardReason;
}

function outcomeOf({
  consumeResult,
  status,
}: {
  consumeResult: { outcome: SignalConsumeOutcome };
  status: string;
}): ImportReviewResolutionOutcome {
  if (consumeResult.outcome === 'REJECTED') {
    return 'REJECTED';
  }
  if (consumeResult.outcome === 'REVIEW_REQUIRED') {
    return 'REVIEW_REQUIRED';
  }
  return status as ImportReviewResolutionOutcome;
}
