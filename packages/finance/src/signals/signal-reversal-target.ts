import { Injectable } from '@nestjs/common';
import { PrismaService } from '@personal-os/database';
import { LedgerQueryService } from '../ledger/application/ledger-query.service';
import type { LedgerTransactionRow } from '../ledger/application/ports/ledger.repository.port';
import {
  classifyReversalCandidates,
  evaluateReversalOriginal,
  REVERSAL_CARD_ACCOUNT_WINDOW_MS,
  REVERSAL_REVIEW_REASON,
  type ReversalOriginal,
  type ReversalReviewReason,
  type ReversalStep,
  type ReversalTargetDecision,
} from '../ledger/application/resolve-reversal-target';
import type { SignalCandidate } from './signal-import-payload';

function toReversalOriginal(row: LedgerTransactionRow): ReversalOriginal {
  return {
    id: row.id,
    status: row.status,
    type: row.type,
    transferGroupId: row.transferGroupId,
    amount: Number(row.amount),
    currency: row.currency,
    accountId: row.accountId,
    cardId: row.cardId,
    categoryId: row.categoryId,
    aiMetadata: row.aiMetadata,
  };
}

/** Busca el gasto original de un reverso por referencia, correo, comercio o tarjeta. */
@Injectable()
export class ReversalTargetResolver {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerQueryService,
  ) {}

  async resolve({
    userId,
    candidate,
    originalTransactionId,
  }: {
    userId: string;
    candidate: SignalCandidate;
    originalTransactionId?: string;
  }): Promise<ReversalTargetDecision> {
    const reversalAmount = candidate.amount!;
    const reversalCurrency = candidate.currency!;
    if (originalTransactionId) {
      return this.resolveChosenOriginal({
        userId,
        originalTransactionId,
        reversalAmount,
        reversalCurrency,
      });
    }
    const reference = candidate.reverseOfBankReference?.trim() || null;
    if (reference) {
      const originals = await this.ledger.findTransactionsByExternalReference(
        userId,
        reference,
      );
      return classifyReversalCandidates({
        candidates: originals.map(toReversalOriginal),
        reversalAmount,
        reversalCurrency,
        step: 'REFERENCE',
        notFoundReason: REVERSAL_REVIEW_REASON.REFERENCE_NOT_FOUND,
      });
    }

    const emailMessageId = candidate.reverseOfEmailMessageId?.trim() || null;
    if (emailMessageId) {
      const original =
        await this.ledger.findImportedTransactionByEmailMessageId(
          userId,
          emailMessageId,
        );
      if (original) {
        return evaluateReversalOriginal({
          original: toReversalOriginal(original),
          reversalAmount,
          reversalCurrency,
          step: 'EMAIL',
        });
      }
    }

    if (!candidate.merchant) {
      return this.resolveFromCard(userId, candidate);
    }
    if (!candidate.transactionDate) {
      return this.review(
        'CANDIDATE',
        REVERSAL_REVIEW_REASON.ORIGINAL_NOT_FOUND,
      );
    }
    const candidates = await this.ledger.findReverseCandidates(userId, {
      amount: reversalAmount,
      currency: reversalCurrency,
      merchant: candidate.merchant,
      aroundDate: new Date(candidate.transactionDate),
      statuses: ['CONFIRMED'],
    });
    return classifyReversalCandidates({
      candidates: candidates.map(toReversalOriginal),
      reversalAmount,
      reversalCurrency,
      step: 'CANDIDATE',
    });
  }

  /**
   * Un original elegido por una persona se valida con las mismas reglas que un
   * candidato automático: confirmado, gasto propio, misma moneda y monto
   * suficiente. Si no cuadra, el import sigue en revisión.
   */
  private async resolveChosenOriginal({
    userId,
    originalTransactionId,
    reversalAmount,
    reversalCurrency,
  }: {
    userId: string;
    originalTransactionId: string;
    reversalAmount: number;
    reversalCurrency: string;
  }): Promise<ReversalTargetDecision> {
    const original = await this.prisma.finTransaction.findFirst({
      where: { id: originalTransactionId, userId },
      select: {
        id: true,
        status: true,
        type: true,
        transferGroupId: true,
        amount: true,
        currency: true,
        accountId: true,
        cardId: true,
        categoryId: true,
        aiMetadata: true,
      },
    });
    if (!original) {
      return this.review('HUMAN', REVERSAL_REVIEW_REASON.ORIGINAL_NOT_FOUND);
    }
    return evaluateReversalOriginal({
      original: { ...original, amount: Number(original.amount) },
      reversalAmount,
      reversalCurrency,
      step: 'HUMAN',
    });
  }

  /**
   * Sin comercio, el reverso se apoya en la tarjeta: su cuenta y el monto deben
   * identificar una sola compra en los tres días anteriores al aviso.
   */
  private async resolveFromCard(
    userId: string,
    candidate: SignalCandidate,
  ): Promise<ReversalTargetDecision> {
    const lastFour = candidate.last4?.trim() || null;
    if (!lastFour) {
      return this.review('CANDIDATE', REVERSAL_REVIEW_REASON.COMMERCE_MISSING);
    }
    const cards = await this.prisma.finCard.findMany({
      where: { userId, isActive: true, lastFour },
      select: { id: true, accountId: true },
    });
    if (cards.length === 0) {
      return this.review(
        'CARD_ACCOUNT',
        REVERSAL_REVIEW_REASON.ORIGINAL_NOT_FOUND,
      );
    }
    if (cards.length > 1) {
      return {
        kind: 'review',
        step: 'CARD_ACCOUNT',
        reason: REVERSAL_REVIEW_REASON.ORIGINAL_AMBIGUOUS,
        candidateIds: [],
      };
    }
    if (!candidate.transactionDate) {
      return this.review(
        'CARD_ACCOUNT',
        REVERSAL_REVIEW_REASON.ORIGINAL_NOT_FOUND,
      );
    }
    const card = cards[0];
    const reversalDate = new Date(candidate.transactionDate);
    const candidates = await this.ledger.findReverseCandidatesByCard(userId, {
      amount: candidate.amount!,
      currency: candidate.currency!,
      cardId: card.id,
      accountId: card.accountId ?? null,
      from: new Date(reversalDate.getTime() - REVERSAL_CARD_ACCOUNT_WINDOW_MS),
      to: reversalDate,
      statuses: ['CONFIRMED'],
    });
    return classifyReversalCandidates({
      candidates: candidates.map(toReversalOriginal),
      reversalAmount: candidate.amount!,
      reversalCurrency: candidate.currency!,
      step: 'CARD_ACCOUNT',
    });
  }

  private review(
    step: ReversalStep,
    reason: ReversalReviewReason,
  ): ReversalTargetDecision {
    return { kind: 'review', step, reason, candidateIds: [] };
  }
}
