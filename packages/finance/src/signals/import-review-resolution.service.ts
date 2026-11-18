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

const FINANCE_TRANSACTION_SIGNAL = 'FINANCE.TRANSACTION_DETECTED';
const EMAIL_SIGNAL_SOURCE = 'EMAIL_MESSAGE';
const REVIEW_IMPORT_LIMIT = 100;

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

type SignalConsumeOutcome =
  'APPLIED' | 'ALREADY_APPLIED' | 'REVIEW_REQUIRED' | 'REJECTED';

export type ImportReviewResolution = {
  id: string;
  status: string;
  outcome: ImportReviewResolutionOutcome;
  transactionId: string | null;
  reviewReason: string | null;
};

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

/**
 * Vía humana para la cola de imports de correo en `REVIEW_REQUIRED`: fija la
 * fecha, el destino o el reverso original elegidos, o descarta el import. Cada
 * decisión se audita y solo escribe en el ledger cuando el import la aplica.
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
    const reviewImport = await this.loadReviewImport({ userId, importId });
    if (input.action === IMPORT_REVIEW_ACTION.DISCARD) {
      return this.discard({ userId, reviewImport, reason: input.reason });
    }
    const prepared = await this.prepareResolution({
      userId,
      input,
    });
    return this.applyResolution({
      userId,
      reviewImport,
      action: input.action,
      prepared,
    });
  }

  private async loadReviewImport({
    userId,
    importId,
  }: {
    userId: string;
    importId: string;
  }): Promise<ReviewImportRow> {
    const reviewImport = await this.prisma.finSignalImport.findFirst({
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

  private async prepareResolution({
    userId,
    input,
  }: {
    userId: string;
    input: ResolveImportReviewInput;
  }): Promise<PreparedResolution> {
    if (input.action === IMPORT_REVIEW_ACTION.SET_DATE) {
      return this.prepareDate(input.transactionDate);
    }
    if (input.action === IMPORT_REVIEW_ACTION.SET_DESTINATION) {
      return this.prepareDestination({ userId, input });
    }
    return this.prepareReversalOriginal({
      userId,
      originalTransactionId: input.originalTransactionId,
    });
  }

  private prepareDate(transactionDate?: string): PreparedResolution {
    if (!transactionDate) {
      throw new BadRequestException(
        'La acción SET_DATE requiere transactionDate',
      );
    }
    const resolvedDate = new Date(transactionDate);
    if (Number.isNaN(resolvedDate.getTime())) {
      throw new BadRequestException('transactionDate no es una fecha válida');
    }
    return {
      override: { transactionDate: resolvedDate },
      changes: { transactionDate: resolvedDate.toISOString() },
    };
  }

  private async prepareDestination({
    userId,
    input,
  }: {
    userId: string;
    input: ResolveImportReviewInput;
  }): Promise<PreparedResolution> {
    const accountId = input.accountId?.trim() || null;
    const cardId = input.cardId?.trim() || null;
    if (accountId && cardId) {
      throw new BadRequestException(
        'La acción SET_DESTINATION requiere una cuenta o una tarjeta',
      );
    }
    if (accountId) {
      return this.prepareAccountDestination({ userId, accountId });
    }
    if (!cardId) {
      throw new BadRequestException(
        'La acción SET_DESTINATION requiere una cuenta o una tarjeta',
      );
    }
    return this.prepareCardDestination({ userId, cardId });
  }

  private async prepareAccountDestination({
    userId,
    accountId,
  }: {
    userId: string;
    accountId: string;
  }): Promise<PreparedResolution> {
    const account = await this.prisma.finAccount.findFirst({
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
    return {
      override: { destination: { accountId: account.id } },
      changes: { accountId: account.id },
    };
  }

  private async prepareCardDestination({
    userId,
    cardId,
  }: {
    userId: string;
    cardId: string;
  }): Promise<PreparedResolution> {
    const card = await this.prisma.finCard.findFirst({
      where: { id: cardId, userId, isActive: true },
      select: { id: true },
    });
    if (!card) {
      throw new NotFoundException('La tarjeta no existe o no está activa');
    }
    return {
      override: { destination: { cardId: card.id } },
      changes: { cardId: card.id },
    };
  }

  private async prepareReversalOriginal({
    userId,
    originalTransactionId,
  }: {
    userId: string;
    originalTransactionId?: string;
  }): Promise<PreparedResolution> {
    const originalId = originalTransactionId?.trim() || null;
    if (!originalId) {
      throw new BadRequestException(
        'La acción LINK_REVERSAL requiere originalTransactionId',
      );
    }
    const original = await this.prisma.finTransaction.findFirst({
      where: { id: originalId, userId },
      select: { id: true },
    });
    if (!original) {
      throw new NotFoundException('El movimiento original no existe');
    }
    return {
      override: { originalTransactionId: original.id },
      changes: { originalTransactionId: original.id },
    };
  }

  private async applyResolution({
    userId,
    reviewImport,
    action,
    prepared,
  }: {
    userId: string;
    reviewImport: ReviewImportRow;
    action: ImportReviewAction;
    prepared: PreparedResolution;
  }): Promise<ImportReviewResolution> {
    const consumeResult = await this.signals.consumeResolved({
      signal: this.toRoutedSignal(reviewImport),
      override: prepared.override,
    });
    const updated = await this.prisma.finSignalImport.findFirst({
      where: { id: reviewImport.id, userId },
      select: { status: true, transactionId: true, reviewReason: true },
    });
    if (!updated) {
      throw new NotFoundException('Import en revisión no encontrado');
    }
    const outcome = this.outcomeOf({
      consumeResult,
      status: updated.status,
    });
    await this.recordResolution({
      userId,
      signalImportId: reviewImport.id,
      action,
      outcome,
      reason: consumeResult.reason ?? updated.reviewReason ?? null,
      changes: prepared.changes,
    });
    if (outcome === 'REVIEW_REQUIRED' || outcome === 'REJECTED') {
      throw new UnprocessableEntityException({
        message: 'El import sigue en revisión',
        importId: reviewImport.id,
        reason: consumeResult.reason ?? updated.reviewReason ?? null,
      });
    }
    return {
      id: reviewImport.id,
      status: updated.status,
      outcome,
      transactionId: updated.transactionId,
      reviewReason: updated.reviewReason,
    };
  }

  private async discard({
    userId,
    reviewImport,
    reason,
  }: {
    userId: string;
    reviewImport: ReviewImportRow;
    reason?: string;
  }): Promise<ImportReviewResolution> {
    const discardReason = this.readDiscardReason(reason);
    await this.prisma.$transaction(async (tx) => {
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

  private async recordResolution({
    userId,
    signalImportId,
    action,
    outcome,
    reason,
    changes,
  }: {
    userId: string;
    signalImportId: string;
    action: ImportReviewAction;
    outcome: ImportReviewResolutionOutcome;
    reason: string | null;
    changes: Prisma.InputJsonObject;
  }): Promise<void> {
    await this.prisma.finSignalImportResolution.create({
      data: {
        userId,
        signalImportId,
        actorUserId: userId,
        action,
        outcome,
        reason,
        changes,
      },
    });
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
