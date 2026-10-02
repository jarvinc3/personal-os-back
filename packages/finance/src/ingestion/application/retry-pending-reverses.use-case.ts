import { Injectable } from '@nestjs/common';
import { LedgerQueryService } from '../../ledger/application/ledger-query.service';
import { ReverseTransactionUseCase } from '../../ledger/application/reverse-transaction.use-case';
import { EmailSourceRepository } from '../infrastructure/email-source.repository';
import { EMAIL_MESSAGE_OUTCOME } from './email-message-outcome';
import { parseExtractedPayload } from './parse-extracted-email';
import type { ExtractedEmailTransaction } from './ports/email-transaction-extractor.port';
import { findReverseOriginal } from './resolve-reverse-original';

const PENDING_REVERSE_BATCH_SIZE = 50;

export type PendingReversalAction =
  | {
      kind: 'apply';
      sourceId: string;
      gmailMessageId: string;
      originalId: string;
      extracted: ExtractedEmailTransaction;
      provider: string | null;
      model: string | null;
    }
  | {
      kind: 'duplicate';
      sourceId: string;
      gmailMessageId: string;
      originalId: string;
      provider: string | null;
      model: string | null;
    }
  | {
      kind: 'unusable';
      sourceId: string;
      gmailMessageId: string;
      provider: string | null;
      model: string | null;
    };

@Injectable()
export class RetryPendingReversesUseCase {
  constructor(
    private readonly emailSources: EmailSourceRepository,
    private readonly ledger: LedgerQueryService,
    private readonly reverseTx: ReverseTransactionUseCase,
  ) {}

  async listActions(userId: string): Promise<PendingReversalAction[]> {
    const messages = await this.emailSources.listPendingReverseMessages(
      userId,
      PENDING_REVERSE_BATCH_SIZE,
    );
    const actions: PendingReversalAction[] = [];
    for (const message of messages) {
      const extracted = parseExtractedPayload(message.extractedPayload);
      if (!extracted || extracted.amount == null) {
        actions.push({
          kind: 'unusable',
          sourceId: message.sourceId,
          gmailMessageId: message.gmailMessageId,
          provider: message.provider,
          model: message.model,
        });
        continue;
      }
      const original = await findReverseOriginal(this.ledger, userId, {
        reverseEmailMessageId: extracted.reverseOfEmailMessageId,
        reverseOriginalRef: extracted.reverseOriginalRef,
        merchant: extracted.merchant,
        amount: extracted.amount,
        currency: extracted.currency,
        aroundDate: new Date(extracted.transactionDate),
      });
      if (!original) {
        continue;
      }
      if (original.status === 'REVERSED') {
        actions.push({
          kind: 'duplicate',
          sourceId: message.sourceId,
          gmailMessageId: message.gmailMessageId,
          originalId: original.id,
          provider: message.provider,
          model: message.model,
        });
        continue;
      }
      actions.push({
        kind: 'apply',
        sourceId: message.sourceId,
        gmailMessageId: message.gmailMessageId,
        originalId: original.id,
        extracted,
        provider: message.provider,
        model: message.model,
      });
    }
    return actions;
  }

  async applyAction(
    userId: string,
    action: PendingReversalAction,
  ): Promise<void> {
    if (action.kind === 'unusable') {
      await this.markUnusable(action);
      return;
    }
    if (action.kind === 'duplicate') {
      await this.markDuplicate(action);
      return;
    }
    await this.applyReverse(userId, action);
  }

  private async applyReverse(
    userId: string,
    action: Extract<PendingReversalAction, { kind: 'apply' }>,
  ): Promise<void> {
    await this.reverseTx.execute(userId, action.originalId, {
      bankStatusRaw: action.extracted.bankStatusRaw,
      bankStatusNormalized: action.extracted.bankStatusNormalized,
      statusEvidence: action.extracted.statusEvidence,
      statusConfidence: action.extracted.statusConfidence,
      reverseEmailMessageId: action.gmailMessageId,
      provider: action.provider,
      model: action.model,
      extractedAt: new Date().toISOString(),
    });
    await this.emailSources.upsertEmailMessage({
      sourceId: action.sourceId,
      gmailMessageId: action.gmailMessageId,
      outcome: EMAIL_MESSAGE_OUTCOME.IMPORTED,
      provider: action.provider,
      model: action.model,
      extractedPayload: action.extracted,
    });
  }

  private async markDuplicate(
    action: Extract<PendingReversalAction, { kind: 'duplicate' }>,
  ): Promise<void> {
    await this.emailSources.upsertEmailMessage({
      sourceId: action.sourceId,
      gmailMessageId: action.gmailMessageId,
      outcome: EMAIL_MESSAGE_OUTCOME.SKIPPED_DUPLICATE,
      reason: `Reversal already applied to transaction ${action.originalId}`,
      provider: action.provider,
      model: action.model,
    });
  }

  private async markUnusable(
    action: Extract<PendingReversalAction, { kind: 'unusable' }>,
  ): Promise<void> {
    await this.emailSources.upsertEmailMessage({
      sourceId: action.sourceId,
      gmailMessageId: action.gmailMessageId,
      outcome: EMAIL_MESSAGE_OUTCOME.FAILED_NON_RETRYABLE,
      reason: 'Pending reversal has no usable extracted payload',
      provider: action.provider,
      model: action.model,
    });
  }
}
