import { Injectable } from '@nestjs/common';
import type { RoutedSignal, SignalImportPreview } from '@personal-os/contracts';
import type { ImportFinancialMovementInput } from '../ledger/application/import-financial-transaction.use-case';
import type { ImportPlan } from './signal-import-plan';
import { SignalImportReviewReasons } from './signal-import-review-reasons';

const REVERSAL_WOULD_APPLY = 'REVERSAL_WOULD_APPLY';

/** Vista previa de la importación: describe lo que el plan escribiría. */
@Injectable()
export class SignalImportPreviewReader {
  constructor(private readonly reviewReasons: SignalImportReviewReasons) {}

  async describe({
    signal,
    plan,
  }: {
    signal: RoutedSignal;
    plan: ImportPlan;
  }): Promise<SignalImportPreview> {
    const preview = this.describePlan(plan);
    if (preview.outcome !== 'REVIEW_REQUIRED') {
      return preview;
    }
    const reviewReasons = await this.reviewReasons.collect({
      signal,
      primaryReason: preview.reason,
    });
    return {
      ...preview,
      reason: reviewReasons[0] ?? preview.reason,
      reviewReasons,
    };
  }

  private describePlan(plan: ImportPlan): SignalImportPreview {
    switch (plan.kind) {
      case 'RETURN':
      case 'RECORD':
        return {
          outcome: plan.consumeResult.outcome,
          reason: plan.consumeResult.reason,
          domainReferences: plan.consumeResult.domainReferences,
        };
      case 'REVERSE':
        return {
          outcome: 'APPLIED',
          reason: REVERSAL_WOULD_APPLY,
          domainReferences: [{ type: 'FinTransaction', id: plan.originalId }],
        };
      case 'CARD_PAYMENT':
        return {
          outcome: 'APPLIED',
          cardPayment: {
            sourceAccountId: plan.payment.sourceAccountId,
            cardId: plan.payment.cardId,
            amount: plan.payment.amount,
            currency: plan.payment.currency,
            status: plan.payment.status,
            transactionDate: plan.payment.transactionDate.toISOString(),
            description: plan.payment.description,
            externalReference: plan.payment.externalReference,
            importReference: plan.payment.importReference,
          },
        };
      case 'IMPORT':
        return {
          outcome: 'APPLIED',
          movement: this.movementPreview(plan.draft.input),
        };
      default: {
        const unhandled: never = plan;
        throw new Error(`Unhandled import plan: ${JSON.stringify(unhandled)}`);
      }
    }
  }

  private movementPreview(
    input: ImportFinancialMovementInput,
  ): NonNullable<SignalImportPreview['movement']> {
    return {
      accountId: input.accountId ?? null,
      cardId: input.cardId ?? null,
      amount: input.amount,
      currency: input.currency,
      type: input.type ?? 'DEBIT',
      status: input.status,
      transactionDate: input.transactionDate.toISOString(),
      description: input.description,
      categoryId: input.categoryId ?? null,
      legRole: input.legRole ?? null,
      externalReference: input.externalReference ?? null,
      importReference: input.importReference,
    };
  }
}
