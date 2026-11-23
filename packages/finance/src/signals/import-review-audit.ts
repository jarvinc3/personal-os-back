import type { Prisma } from '@personal-os/database';
import { PrismaService } from '@personal-os/database';
import type { ImportReviewAction } from './import-review-actions';
import type { ImportReviewResolutionOutcome } from './import-review-resolution.service';

const PENDING_RESOLUTION_OUTCOME = 'PENDING';

/**
 * La fila se escribe antes de tocar el ledger y se completa al terminar. Si el
 * proceso cae entre la escritura del movimiento y su resultado, la fila queda
 * en `PENDING` y el movimiento sigue siendo rastreable.
 */
export class ImportReviewAudit {
  constructor(private readonly prisma: PrismaService) {}

  async start({
    userId,
    signalImportId,
    action,
    changes,
  }: {
    userId: string;
    signalImportId: string;
    action: ImportReviewAction;
    changes: Prisma.InputJsonObject;
  }): Promise<string> {
    const resolution = await this.prisma.finSignalImportResolution.create({
      data: {
        userId,
        signalImportId,
        actorUserId: userId,
        action,
        outcome: PENDING_RESOLUTION_OUTCOME,
        changes,
      },
      select: { id: true },
    });
    return resolution.id;
  }

  async complete({
    userId,
    resolutionId,
    outcome,
    reason,
  }: {
    userId: string;
    resolutionId: string;
    outcome: ImportReviewResolutionOutcome;
    reason: string | null;
  }): Promise<void> {
    await this.prisma.finSignalImportResolution.updateMany({
      where: { id: resolutionId, userId },
      data: { outcome, reason },
    });
  }
}
