import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { JsonObject, RoutedSignal } from '@personal-os/contracts';
import { PrismaService, type Prisma } from '@personal-os/database';
import { isBankAccountType } from '../shared/domain/account-number';
import {
  FinanceSignalConsumer,
  type ImportResolutionOverride,
} from './finance-signal-consumer';
import {
  IMPORT_REVIEW_ACTION,
  type ImportReviewAction,
} from './import-review-actions';
import {
  lockSignalImports,
  SIGNAL_IMPORT_TRANSACTION_MAX_WAIT_MS,
  SIGNAL_IMPORT_TRANSACTION_TIMEOUT_MS,
} from './signal-import-lock';

const FINANCE_TRANSACTION_SIGNAL = 'FINANCE.TRANSACTION_DETECTED';
const EMAIL_SIGNAL_SOURCE = 'EMAIL_MESSAGE';
const REVIEW_IMPORT_LIMIT = 100;
const PENDING_RESOLUTION_OUTCOME = 'PENDING';

export type ResolveImportReviewInput = {
  action: ImportReviewAction;
  transactionDate?: string;
  accountId?: string;
  cardId?: string;
  originalTransactionId?: string;
  reason?: string;
};

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

type ReviewImportRow = {
  id: string;
  userId: string;
  signalId: string;
  sourceEmailMessageId: string;
  candidate: Prisma.JsonValue;
  createdAt: Date;
};

type PreparedResolution = {
  override: ImportResolutionOverride;
  changes: Prisma.InputJsonObject;
};

type ResolutionAttempt =
  | { kind: 'resolved'; resolution: ImportReviewResolution }
  | { kind: 'unresolved'; importId: string; reason: string | null };

type ReplaceableChanges = Record<string, string>;

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly signals: FinanceSignalConsumer,
  ) {}

  async listForUser(userId: string) {
    const reviewImports = await this.prisma.finSignalImport.findMany({
      where: { userId, status: 'REVIEW_REQUIRED' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: REVIEW_IMPORT_LIMIT,
    });
    return reviewImports.map((reviewImport) => ({
      id: reviewImport.id,
      signalId: reviewImport.signalId,
      sourceEmailMessageId: reviewImport.sourceEmailMessageId,
      reviewReason: reviewImport.reviewReason,
      candidate: reviewImport.candidate,
      createdAt: reviewImport.createdAt.toISOString(),
      updatedAt: reviewImport.updatedAt.toISOString(),
    }));
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
        const reviewImport = await this.loadReviewImport({
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
        const prepared = await this.prepareResolution({ userId, input, tx });
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

  private async loadReviewImport({
    userId,
    importId,
    tx,
  }: {
    userId: string;
    importId: string;
    tx: Prisma.TransactionClient;
  }): Promise<ReviewImportRow> {
    const reviewImport = await tx.finSignalImport.findFirst({
      where: { id: importId, userId },
      select: {
        id: true,
        userId: true,
        signalId: true,
        sourceEmailMessageId: true,
        status: true,
        candidate: true,
        createdAt: true,
      },
    });
    if (!reviewImport) {
      throw new NotFoundException('Import en revisión no encontrado');
    }
    if (reviewImport.status !== 'REVIEW_REQUIRED') {
      throw new ConflictException('El import ya no está en revisión');
    }
    return reviewImport;
  }

  /**
   * Una decisión puede traer más de una corrección: un pago de tarjeta puede
   * necesitar su cuenta de origen y su tarjeta a la vez, y un movimiento puede
   * necesitar fecha y destino. Se aplican juntas.
   */
  private async prepareResolution({
    userId,
    input,
    tx,
  }: {
    userId: string;
    input: ResolveImportReviewInput;
    tx: Prisma.TransactionClient;
  }): Promise<PreparedResolution> {
    const override: ImportResolutionOverride = {};
    const changes: ReplaceableChanges = {};
    if (input.transactionDate) {
      const resolvedDate = this.readTransactionDate(input.transactionDate);
      override.transactionDate = resolvedDate;
      changes.transactionDate = resolvedDate.toISOString();
    }
    if (input.accountId || input.cardId) {
      const destination = await this.prepareDestination({ userId, input, tx });
      override.destination = destination.destination;
      Object.assign(changes, destination.changes);
    }
    if (input.originalTransactionId) {
      const originalTransactionId = await this.prepareReversalOriginal({
        userId,
        originalTransactionId: input.originalTransactionId,
        tx,
      });
      override.originalTransactionId = originalTransactionId;
      changes.originalTransactionId = originalTransactionId;
    }
    this.assertActionHasData({ action: input.action, override });
    return { override, changes };
  }

  private assertActionHasData({
    action,
    override,
  }: {
    action: ImportReviewAction;
    override: ImportResolutionOverride;
  }): void {
    if (action === IMPORT_REVIEW_ACTION.SET_DATE && !override.transactionDate) {
      throw new BadRequestException(
        'La acción SET_DATE requiere transactionDate',
      );
    }
    if (
      action === IMPORT_REVIEW_ACTION.SET_DESTINATION &&
      !override.destination
    ) {
      throw new BadRequestException(
        'La acción SET_DESTINATION requiere una cuenta o una tarjeta',
      );
    }
    if (
      action === IMPORT_REVIEW_ACTION.LINK_REVERSAL &&
      !override.originalTransactionId
    ) {
      throw new BadRequestException(
        'La acción LINK_REVERSAL requiere originalTransactionId',
      );
    }
  }

  private readTransactionDate(transactionDate: string): Date {
    const resolvedDate = new Date(transactionDate);
    if (Number.isNaN(resolvedDate.getTime())) {
      throw new BadRequestException('transactionDate no es una fecha válida');
    }
    return resolvedDate;
  }

  private async prepareDestination({
    userId,
    input,
    tx,
  }: {
    userId: string;
    input: ResolveImportReviewInput;
    tx: Prisma.TransactionClient;
  }): Promise<{
    destination: { accountId?: string; cardId?: string };
    changes: ReplaceableChanges;
  }> {
    const destination: { accountId?: string; cardId?: string } = {};
    const changes: ReplaceableChanges = {};
    const accountId = input.accountId?.trim() || null;
    const cardId = input.cardId?.trim() || null;
    if (accountId) {
      const account = await this.loadOwnedAccount({ userId, accountId, tx });
      destination.accountId = account.id;
      changes.accountId = account.id;
    }
    if (cardId) {
      const card = await this.loadOwnedCard({ userId, cardId, tx });
      destination.cardId = card.id;
      changes.cardId = card.id;
    }
    return { destination, changes };
  }

  private async loadOwnedAccount({
    userId,
    accountId,
    tx,
  }: {
    userId: string;
    accountId: string;
    tx: Prisma.TransactionClient;
  }): Promise<{ id: string }> {
    const account = await tx.finAccount.findFirst({
      where: { id: accountId, userId, isActive: true },
      select: { id: true, type: true },
    });
    if (!account) {
      throw new NotFoundException('La cuenta no existe o no está activa');
    }
    if (!isBankAccountType(account.type)) {
      throw new BadRequestException(
        'La cuenta elegida no sirve como destino de un movimiento',
      );
    }
    return { id: account.id };
  }

  private async loadOwnedCard({
    userId,
    cardId,
    tx,
  }: {
    userId: string;
    cardId: string;
    tx: Prisma.TransactionClient;
  }): Promise<{ id: string }> {
    const card = await tx.finCard.findFirst({
      where: { id: cardId, userId, isActive: true },
      select: { id: true },
    });
    if (!card) {
      throw new NotFoundException('La tarjeta no existe o no está activa');
    }
    return { id: card.id };
  }

  private async prepareReversalOriginal({
    userId,
    originalTransactionId,
    tx,
  }: {
    userId: string;
    originalTransactionId: string;
    tx: Prisma.TransactionClient;
  }): Promise<string> {
    const originalId = originalTransactionId.trim();
    const original = await tx.finTransaction.findFirst({
      where: { id: originalId, userId },
      select: { id: true },
    });
    if (!original) {
      throw new NotFoundException('El movimiento original no existe');
    }
    return original.id;
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
    const resolutionId = await this.recordResolutionStart({
      userId,
      signalImportId: reviewImport.id,
      action,
      changes: prepared.changes,
    });
    const consumeResult = await this.signals.consumeResolved({
      signal: this.toRoutedSignal(reviewImport),
      override: prepared.override,
    });
    const updated = await tx.finSignalImport.findFirst({
      where: { id: reviewImport.id, userId },
      select: { status: true, transactionId: true, reviewReason: true },
    });
    if (!updated) {
      await this.completeResolution({
        userId,
        resolutionId,
        outcome: 'REJECTED',
        reason: 'IMPORT_NOT_FOUND',
      });
      throw new NotFoundException('Import en revisión no encontrado');
    }
    const outcome = this.outcomeOf({
      consumeResult,
      status: updated.status,
    });
    const reviewReason = consumeResult.reason ?? updated.reviewReason ?? null;
    await this.completeResolution({
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

  /**
   * La fila se escribe antes de tocar el ledger y se completa al terminar. Si
   * el proceso cae entre la escritura del movimiento y su resultado, la fila
   * queda en `PENDING` y el movimiento sigue siendo rastreable.
   */
  private async recordResolutionStart({
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

  private async completeResolution({
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
    const discardReason = this.readDiscardReason(reason);
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

  private readDiscardReason(reason?: string): string {
    const discardReason = reason?.trim() ?? '';
    if (discardReason.length === 0) {
      throw new BadRequestException('El descarte requiere un motivo');
    }
    return discardReason;
  }

  private outcomeOf({
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

  private toRoutedSignal(reviewImport: ReviewImportRow): RoutedSignal {
    const { candidate } = reviewImport;
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate)
    ) {
      throw new ConflictException('El import no tiene el candidato guardado');
    }
    return {
      signalId: reviewImport.signalId,
      userId: reviewImport.userId,
      signalType: FINANCE_TRANSACTION_SIGNAL,
      schemaVersion: 1,
      occurredAt: reviewImport.createdAt.toISOString(),
      sourceType: EMAIL_SIGNAL_SOURCE,
      sourceId: reviewImport.sourceEmailMessageId,
      payload: candidate as JsonObject,
    };
  }
}
