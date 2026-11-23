import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@personal-os/database';
import { isBankAccountType } from '../shared/domain/account-number';
import type { ImportResolutionOverride } from './finance-signal-consumer';
import {
  IMPORT_REVIEW_ACTION,
  type ImportReviewAction,
} from './import-review-actions';

export type ResolveImportReviewInput = {
  action: ImportReviewAction;
  transactionDate?: string;
  accountId?: string;
  cardId?: string;
  originalTransactionId?: string;
  reason?: string;
};

export type PreparedResolution = {
  override: ImportResolutionOverride;
  changes: Prisma.InputJsonObject;
};

type ReplaceableChanges = Record<string, string>;

/**
 * Una decisión puede traer más de una corrección: un pago de tarjeta puede
 * necesitar su cuenta de origen y su tarjeta a la vez, y un movimiento puede
 * necesitar fecha y destino. Se preparan juntas.
 */
export class ImportReviewDecision {
  async prepare({
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
      const resolvedDate = readTransactionDate(input.transactionDate);
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
    assertActionHasData({ action: input.action, override });
    return { override, changes };
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
}

function assertActionHasData({
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

function readTransactionDate(transactionDate: string): Date {
  const resolvedDate = new Date(transactionDate);
  if (Number.isNaN(resolvedDate.getTime())) {
    throw new BadRequestException('transactionDate no es una fecha válida');
  }
  return resolvedDate;
}
