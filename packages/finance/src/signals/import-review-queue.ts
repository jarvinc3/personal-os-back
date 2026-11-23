import { ConflictException, NotFoundException } from '@nestjs/common';
import type { JsonObject, RoutedSignal } from '@personal-os/contracts';
import { PrismaService, type Prisma } from '@personal-os/database';

const FINANCE_TRANSACTION_SIGNAL = 'FINANCE.TRANSACTION_DETECTED';
const EMAIL_SIGNAL_SOURCE = 'EMAIL_MESSAGE';
const REVIEW_IMPORT_LIMIT = 100;

export type ReviewImportRow = {
  id: string;
  userId: string;
  signalId: string;
  sourceEmailMessageId: string;
  candidate: Prisma.JsonValue;
  createdAt: Date;
};

/** Cola de imports de correo en `REVIEW_REQUIRED`. */
export class ImportReviewQueue {
  constructor(private readonly prisma: PrismaService) {}

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

  async loadOne({
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

  /** La señal guardada viaja al consumidor como el correo original. */
  toRoutedSignal(reviewImport: ReviewImportRow): RoutedSignal {
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
