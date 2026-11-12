import { Injectable, Logger } from '@nestjs/common';
import type { RoutedSignal, SignalImportPreview } from '@personal-os/contracts';
import { PrismaService, type Prisma } from '@personal-os/database';
import { z } from 'zod';
import { buildFinancialImportNotes } from '../ledger/application/build-import-notes';
import {
  MOVEMENT_CLASSES,
  isAtmMovementClass,
  isCardPaymentMovementClass,
  isTransferMovementClass,
  type MovementClass,
} from '../ledger/domain/movement-class';
import {
  ImportCardPaymentUseCase,
  type ImportCardPaymentInput,
} from '../ledger/application/import-card-payment.use-case';
import {
  isUnpairedTransferCandidate,
  movementClassOf,
  pickTransferMatch,
  REFERENCE_MATCH_WINDOW_MS,
  type ImportTransferCandidate,
  uniqueCashAccountId,
} from '../ledger/application/match-imported-transfers';
import {
  accountMatchesHint,
  resolveLedgerTargetFromHints,
} from '../ledger/application/resolve-ledger-target-from-hints';
import {
  classifyTransferImport,
  resolveTransferAccount,
  transferLegIdentity,
  type IncomingTransferLeg,
  type TransferAccountCandidate,
  type TransferImportDecision,
  type TransferLegIdentity,
} from '../ledger/application/resolve-transfer-import';
import {
  classifyReversalCandidates,
  evaluateReversalOriginal,
  REVERSAL_REVIEW_REASON,
  type ReversalOriginal,
  type ReversalReviewReason,
  type ReversalTargetDecision,
} from '../ledger/application/resolve-reversal-target';
import {
  PartialReversalAlreadyAppliedError,
  PartialReversalAlreadyReversedError,
  PartialReversalExceedsOriginalError,
  PartialReversalNotApplicableError,
} from '../ledger/application/partial-reversal.errors';
import {
  financeValidationReviewReasons,
  orderFinanceReviewReasons,
} from './finance-review-reasons';
import type { LedgerTransactionRow } from '../ledger/application/ports/ledger.repository.port';
import {
  ImportFinancialTransactionUseCase,
  type ImportFinancialMovementInput,
} from '../ledger/application/import-financial-transaction.use-case';
import { LedgerQueryService } from '../ledger/application/ledger-query.service';
import { ReverseTransactionUseCase } from '../ledger/application/reverse-transaction.use-case';
import { UNKNOWN_MERCHANT } from '../shared/domain/unknown-merchant';
import { toMoney } from '../shared/domain/money';
import { MerchantsService } from '../merchants/application/merchants.service';
import { ResolveUserBaseCurrencyUseCase } from '../fx/application/resolve-user-base-currency';
import { resolveCategoryIdForImport } from '../shared/domain/category-type';
import {
  mapBankStatusToInternal,
  type FinTransactionStatusValue,
} from '../shared/domain/transaction-status';
import type { FinanceSignalConsumerPort } from '../contracts';

const transactionSchema = z
  .object({
    kind: z.enum(['TRANSACTION', 'PENDING', 'NOT_TRANSACTION']).optional(),
    amount: z.number().positive().optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    transactionDate: z.string().datetime().optional(),
    suggestedTransactionDate: z.string().datetime().optional(),
    suggestedTransactionDateSource: z.literal('EMAIL_HEADER').optional(),
    direction: z.enum(['DEBIT', 'CREDIT', 'TRANSFER']).optional(),
    merchant: z.string().trim().min(1).max(160).optional(),
    bankReference: z.string().trim().min(1).max(120).optional(),
    last4: z
      .string()
      .regex(/^\d{4}$/)
      .optional(),
    accountNumberLast4: z
      .string()
      .regex(/^\d{4}$/)
      .optional(),
    movementClass: z.enum(MOVEMENT_CLASSES).optional(),
    bankStatusNormalized: z
      .enum([
        'APPROVED',
        'COMPLETED',
        'POSTED',
        'PENDING',
        'IN_PROGRESS',
        'AUTHORIZED',
        'DECLINED',
        'REJECTED',
        'FAILED',
        'CANCELLED',
        'VOIDED',
        'REVERSED',
        'REFUNDED',
        'CHARGEBACK',
        'UNKNOWN',
      ])
      .optional(),
    statusConfidence: z.number().min(0).max(1).optional(),
    statusEvidence: z.string().trim().max(240).optional(),
    reverseOfBankReference: z.string().trim().min(1).max(120).optional(),
    reverseOfEmailMessageId: z.string().trim().min(1).max(512).optional(),
    receivedAmount: z.number().positive().optional(),
    transferExchangeRate: z.number().positive().optional(),
    categoryNameHint: z.string().trim().min(1).max(80).optional(),
  })
  .passthrough();

const payloadSchema = z
  .object({
    relevance: z.boolean().optional(),
    semanticType: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    transaction: transactionSchema.nullable().optional(),
    routes: z.array(z.string()).optional(),
  })
  .passthrough();

type Candidate = z.infer<typeof transactionSchema>;
type ImportStatus =
  'IMPORTED' | 'DUPLICATE' | 'REVERSED' | 'REVIEW_REQUIRED' | 'FAILED';

const REVIEW_CONFIDENCE_THRESHOLD = 0.7;
const REVERSAL_WOULD_APPLY = 'REVERSAL_WOULD_APPLY';
const PENDING_REVERSAL_RETRY_LIMIT = 20;
type ImportReviewEvidence = Record<string, string | string[] | number | null>;
type ConsumeResult = Awaited<ReturnType<FinanceSignalConsumerPort['consume']>>;

type SignalConsumeResult = {
  outcome: 'APPLIED' | 'ALREADY_APPLIED' | 'REVIEW_REQUIRED' | 'REJECTED';
  domainReferences: readonly { type: string; id: string }[];
  reason?: string;
};

/**
 * Lo que la importación escribiría. Se calcula solo con lecturas, así la vista
 * previa y la ejecución parten de la misma decisión.
 */
type ImportDraft = {
  input: ImportFinancialMovementInput;
  cashAccountId: string | null;
  transfer: boolean;
};

type ImportPlan =
  | { kind: 'RETURN'; result: SignalConsumeResult }
  | {
      kind: 'RECORD';
      status: ImportStatus;
      result: SignalConsumeResult;
      reason?: string;
      transactionId?: string | null;
      duplicateOfTransactionId?: string | null;
      evidence?: ImportReviewEvidence;
    }
  | { kind: 'REVERSE'; originalId: string; metadata: Record<string, unknown> }
  | { kind: 'CARD_PAYMENT'; payment: ImportCardPaymentInput }
  | { kind: 'IMPORT'; draft: ImportDraft };

const pairingInstrumentInclude = {
  account: { select: { institutionId: true, type: true } },
  card: { select: { institutionId: true } },
} satisfies Prisma.FinTransactionInclude;

type PairingTransactionRow = Prisma.FinTransactionGetPayload<{
  include: typeof pairingInstrumentInclude;
}>;

@Injectable()
export class FinanceSignalConsumer implements FinanceSignalConsumerPort {
  readonly domain = 'FINANCE';
  private readonly logger = new Logger(FinanceSignalConsumer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly importTransaction: ImportFinancialTransactionUseCase,
    private readonly ledger: LedgerQueryService,
    private readonly reverseTransaction: ReverseTransactionUseCase,
    private readonly cardPaymentImport: ImportCardPaymentUseCase,
    private readonly merchants: MerchantsService,
    private readonly baseCurrency: ResolveUserBaseCurrencyUseCase,
  ) {}

  async consume(signal: RoutedSignal) {
    const plan = await this.buildImportPlan(signal);
    const consumeResult = await this.applyImportPlan(signal, plan);
    if (
      consumeResult.outcome === 'ALREADY_APPLIED' &&
      this.isTransferSignal(signal)
    ) {
      const transactionId = consumeResult.domainReferences[0]?.id;
      if (transactionId) {
        await this.tryPairTransfer(signal.userId, transactionId);
      }
    }
    return consumeResult;
  }

  private isTransferSignal(signal: RoutedSignal): boolean {
    const parsed = payloadSchema.safeParse(signal.payload);
    if (!parsed.success) {
      return false;
    }
    return isTransferMovementClass(parsed.data.transaction?.movementClass);
  }

  /** Igual que `consume`, pero sin escribir ni señales ni ledger. */
  async preview(signal: RoutedSignal): Promise<SignalImportPreview> {
    const plan = await this.buildImportPlan(signal);
    const preview = this.describeImportPlan(plan);
    if (preview.outcome !== 'REVIEW_REQUIRED') {
      return preview;
    }
    const reviewReasons = await this.collectPreviewReviewReasons(
      signal,
      preview.reason,
    );
    return {
      ...preview,
      reason: reviewReasons[0] ?? preview.reason,
      reviewReasons,
    };
  }

  /** Reads independent blockers without changing the execution decision. */
  private async collectPreviewReviewReasons(
    signal: RoutedSignal,
    primaryReason?: string,
  ): Promise<string[]> {
    const reasons = primaryReason ? [primaryReason] : ['REVIEW_REQUIRED'];
    const parsed = payloadSchema.safeParse(signal.payload);
    if (!parsed.success || !parsed.data.transaction) {
      return orderFinanceReviewReasons(reasons);
    }

    const candidate = parsed.data.transaction;
    if (candidate.kind === 'NOT_TRANSACTION') {
      return orderFinanceReviewReasons(reasons);
    }
    reasons.push(...financeValidationReviewReasons(candidate));

    const movementClass = this.movementClass(candidate);
    const status =
      candidate.kind === 'PENDING'
        ? 'PENDING'
        : mapBankStatusToInternal({
            bankStatusNormalized: candidate.bankStatusNormalized ?? 'UNKNOWN',
            statusConfidence:
              candidate.statusConfidence ?? parsed.data.confidence ?? 0,
          });

    if (status === 'REVERSED') {
      const canResolveReversalWithoutDate = Boolean(
        candidate.reverseOfBankReference ||
        candidate.reverseOfEmailMessageId ||
        !candidate.merchant ||
        candidate.transactionDate,
      );
      if (
        candidate.amount != null &&
        candidate.currency &&
        canResolveReversalWithoutDate
      ) {
        const reversalPlan = await this.buildReversalPlan(signal, candidate);
        if (
          reversalPlan.kind === 'RECORD' &&
          reversalPlan.status === 'REVIEW_REQUIRED' &&
          reversalPlan.reason
        ) {
          reasons.push(reversalPlan.reason);
        }
      }
      return orderFinanceReviewReasons(reasons);
    }

    if (
      candidate.direction === 'TRANSFER' &&
      !isTransferMovementClass(movementClass)
    ) {
      reasons.push('TRANSFER_DIRECTION_AMBIGUOUS');
    }
    if (isTransferMovementClass(movementClass) && !candidate.direction) {
      reasons.push('TRANSFER_SIDE_MISSING');
    }

    const activeAccounts = await this.prisma.finAccount.findMany({
      where: { userId: signal.userId, isActive: true },
      select: {
        id: true,
        accountNumberLast4: true,
        isDefaultForInstitution: true,
        type: true,
        currency: true,
      },
    });

    if (isCardPaymentMovementClass(movementClass)) {
      if (status !== 'CONFIRMED') {
        reasons.push('CARD_PAYMENT_NOT_CONFIRMED');
      }
      const card = await this.resolveCardPaymentCard({
        userId: signal.userId,
        lastFour: candidate.last4 ?? null,
      });
      if (card.kind === 'review') {
        reasons.push(card.reason);
      }
      const account = this.resolveCardPaymentAccount({
        accounts: activeAccounts,
        accountNumberLast4: candidate.accountNumberLast4 ?? null,
      });
      if (account.kind === 'review') {
        reasons.push(account.reason);
      }
      if (
        card.kind === 'resolved' &&
        candidate.currency &&
        !card.currencies.includes(candidate.currency)
      ) {
        reasons.push('CARD_CURRENCY_MISSING');
      }
      return orderFinanceReviewReasons(reasons);
    }

    if (isTransferMovementClass(movementClass)) {
      const transferTarget = this.resolveTransferTarget({
        candidate,
        movementClass,
        accounts: activeAccounts,
      });
      if (transferTarget.kind === 'review') {
        reasons.push(transferTarget.reason);
      }
      return orderFinanceReviewReasons(reasons);
    }

    const activeCards = await this.prisma.finCard.findMany({
      where: { userId: signal.userId, isActive: true },
      select: { id: true, lastFour: true },
    });
    const ledgerTarget = resolveLedgerTargetFromHints({
      instrumentHint: null,
      lastFourHint: candidate.last4 ?? null,
      accountNumberHint: null,
      accounts: activeAccounts,
      cards: activeCards,
      allowDefaultAccount: !isAtmMovementClass(movementClass),
    });
    if (ledgerTarget.kind !== 'unique') {
      reasons.push(
        ledgerTarget.kind === 'ambiguous'
          ? 'AMBIGUOUS_LEDGER_TARGET'
          : 'NO_LEDGER_TARGET',
      );
    }
    if (isAtmMovementClass(movementClass)) {
      const cashAccounts = await this.prisma.finAccount.findMany({
        where: { userId: signal.userId, isActive: true, type: 'CASH' },
        select: { id: true },
      });
      if (!uniqueCashAccountId(cashAccounts)) {
        reasons.push('ATM_CASH_ACCOUNT_AMBIGUOUS');
      }
    }
    return orderFinanceReviewReasons(reasons);
  }

  private async buildImportPlan(signal: RoutedSignal): Promise<ImportPlan> {
    if (signal.signalType !== 'FINANCE.TRANSACTION_DETECTED') {
      return this.returnPlan({
        outcome: 'REJECTED',
        domainReferences: [],
        reason: 'UNSUPPORTED_FINANCE_SIGNAL',
      });
    }

    const prior = await this.prisma.finSignalImport.findUnique({
      where: {
        userId_signalId: { userId: signal.userId, signalId: signal.signalId },
      },
    });
    if (prior) {
      return this.returnPlan(
        this.fromStored(
          prior.status,
          prior.reviewReason,
          prior.transactionId ?? prior.duplicateOfTransactionId,
        ),
      );
    }

    const existingTransaction =
      await this.ledger.findTransactionByImportReference(
        signal.signalId,
        signal.userId,
      );
    if (existingTransaction) {
      return this.importedPlan(existingTransaction.id);
    }

    const parsed = payloadSchema.safeParse(signal.payload);
    if (!parsed.success) {
      return this.failedPlan('INVALID_SIGNAL_PAYLOAD');
    }
    const payload = parsed.data;
    const candidate = payload.transaction;
    if (!candidate || candidate.kind === 'NOT_TRANSACTION') {
      return this.failedPlan('NO_TRANSACTION_CANDIDATE');
    }

    if (
      payload.relevance === false ||
      !payload.routes?.includes('FINANCE') ||
      (payload.confidence ?? 0) < REVIEW_CONFIDENCE_THRESHOLD
    ) {
      return this.reviewPlan('LOW_CONFIDENCE_OR_NOT_FINANCE');
    }

    const validationReason = this.validationReason(candidate);
    if (validationReason) {
      return this.reviewPlan(
        validationReason,
        validationReason === 'TRANSACTION_DATE_SUGGESTED'
          ? {
              suggestedTransactionDate:
                candidate.suggestedTransactionDate ?? null,
              suggestedTransactionDateSource:
                candidate.suggestedTransactionDateSource ?? null,
            }
          : undefined,
      );
    }

    const movementClass = this.movementClass(candidate);
    if (
      candidate.direction === 'TRANSFER' &&
      !isTransferMovementClass(movementClass)
    ) {
      return this.reviewPlan('TRANSFER_DIRECTION_AMBIGUOUS');
    }
    if (isTransferMovementClass(movementClass) && !candidate.direction) {
      return this.reviewPlan('TRANSFER_SIDE_MISSING');
    }

    const activeAccounts = await this.prisma.finAccount.findMany({
      where: { userId: signal.userId, isActive: true },
      select: {
        id: true,
        accountNumberLast4: true,
        isDefaultForInstitution: true,
        type: true,
        currency: true,
      },
    });
    const activeCards = await this.prisma.finCard.findMany({
      where: { userId: signal.userId, isActive: true },
      select: { id: true, lastFour: true },
    });
    const amount = candidate.amount!;
    const currency = candidate.currency!;
    const transactionDate = new Date(candidate.transactionDate!);
    const type = this.transactionType(candidate, movementClass);
    const status =
      candidate.kind === 'PENDING'
        ? 'PENDING'
        : mapBankStatusToInternal({
            bankStatusNormalized: candidate.bankStatusNormalized ?? 'UNKNOWN',
            statusConfidence:
              candidate.statusConfidence ?? payload.confidence ?? 0,
          });
    if (status === 'REVERSED') {
      return this.buildReversalPlan(signal, candidate);
    }

    if (isCardPaymentMovementClass(movementClass)) {
      return this.buildCardPaymentPlan({
        signal,
        payload,
        candidate,
        accounts: activeAccounts,
        status,
      });
    }

    const transfer = isTransferMovementClass(movementClass);
    let target: { accountId?: string; cardId?: string };
    let transferLeg: TransferLegIdentity | null = null;
    if (transfer) {
      const transferTarget = this.resolveTransferTarget({
        candidate,
        movementClass,
        accounts: activeAccounts,
      });
      if (transferTarget.kind === 'review') {
        return this.reviewPlan(transferTarget.reason, transferTarget.evidence);
      }
      target = { accountId: transferTarget.accountId };
      transferLeg = transferTarget.leg;
    } else {
      const ledgerTarget = resolveLedgerTargetFromHints({
        instrumentHint: null,
        lastFourHint: candidate.last4 ?? null,
        accountNumberHint: null,
        accounts: activeAccounts,
        cards: activeCards,
        allowDefaultAccount: !isAtmMovementClass(movementClass),
      });
      if (ledgerTarget.kind !== 'unique') {
        return this.reviewPlan(
          ledgerTarget.kind === 'ambiguous'
            ? 'AMBIGUOUS_LEDGER_TARGET'
            : 'NO_LEDGER_TARGET',
          ledgerTarget.kind === 'ambiguous'
            ? {
                candidateCount: ledgerTarget.candidateCount,
                candidateIds: [
                  ...activeCards
                    .filter(
                      (card) =>
                        !candidate.last4 || card.lastFour === candidate.last4,
                    )
                    .map((card) => card.id),
                  ...(candidate.last4
                    ? []
                    : activeAccounts.map((account) => account.id)),
                ],
              }
            : undefined,
        );
      }
      target = ledgerTarget;
    }

    if (
      transfer &&
      transferLeg &&
      target.accountId &&
      candidate.bankReference
    ) {
      const decision = await this.classifyAgainstSharedReference({
        userId: signal.userId,
        bankReference: candidate.bankReference,
        incoming: {
          type: transferLeg.type,
          accountId: target.accountId,
          amount,
          currency,
          transactionDate,
        },
      });
      if (decision.kind === 'duplicate') {
        return this.duplicatePlan(decision.transactionId);
      }
      if (decision.kind === 'conflict') {
        return this.reviewPlan(decision.reason, {
          externalReference: candidate.bankReference,
          candidateTransactionIds: decision.candidateTransactionIds,
        });
      }
    } else {
      const duplicate = await this.ledger.findDedupeCandidate(signal.userId, {
        externalReference: candidate.bankReference ?? null,
        accountId: target.accountId,
        cardId: target.cardId,
        amount,
        currency,
        type,
        merchant: candidate.merchant ?? null,
        transactionDate,
      });
      if (duplicate) {
        return this.duplicatePlan(duplicate.id);
      }
    }

    const categories = await this.prisma.finCategory.findMany({
      where: {
        type: type === 'DEBIT' ? 'EXPENSE' : 'INCOME',
        OR: [{ userId: signal.userId }, { isSystem: true }],
      },
      select: { id: true, name: true, type: true },
    });
    const category =
      transfer || isAtmMovementClass(movementClass)
        ? { categoryId: null, source: null }
        : await resolveCategoryIdForImport({
            categories,
            hint: candidate.categoryNameHint ?? null,
            transactionType: type,
            merchant: candidate.merchant ?? null,
            findMerchantCategoryId: async (merchant) =>
              (await this.merchants.suggest(signal.userId, merchant))
                ?.categoryId ?? null,
            findCategoryIdByMerchant: (merchant) =>
              this.ledger.findLatestCategoryIdByMerchant(
                signal.userId,
                merchant,
              ),
          });
    const notes = buildFinancialImportNotes({
      llmNotes: null,
      categoryId: category.categoryId,
      categorySource: category.source,
      categoryNameHint: candidate.categoryNameHint ?? null,
      status,
      skipUncategorizedWarning: transfer || isAtmMovementClass(movementClass),
    });
    const merchantMissing = !candidate.merchant;
    const merchant = candidate.merchant ?? UNKNOWN_MERCHANT;
    const aiMetadata = {
      ...this.importMetadata({
        signal,
        payload,
        candidate,
        movementClass,
        amount,
        currency,
      }),
      merchantMissing,
    };

    let cashAccountId: string | null = null;
    if (isAtmMovementClass(movementClass)) {
      const cashAccounts = await this.prisma.finAccount.findMany({
        where: { userId: signal.userId, isActive: true, type: 'CASH' },
        select: { id: true },
      });
      cashAccountId = uniqueCashAccountId(cashAccounts);
      if (!cashAccountId) {
        return this.reviewPlan('ATM_CASH_ACCOUNT_AMBIGUOUS');
      }
    }

    return {
      kind: 'IMPORT',
      draft: {
        cashAccountId,
        transfer,
        input: {
          accountId: target.accountId,
          cardId: target.cardId,
          importReference: signal.signalId,
          externalReference: candidate.bankReference,
          amount,
          currency,
          merchant,
          merchantIsPlaceholder: merchantMissing,
          description:
            candidate.merchant ??
            payload.semanticType ??
            'Movimiento por correo',
          notes,
          transactionDate,
          type: transferLeg?.type ?? type,
          legRole: transferLeg?.legRole,
          status,
          categoryId: category.categoryId,
          aiMetadata,
        },
      },
    };
  }

  private async applyImportPlan(
    signal: RoutedSignal,
    plan: ImportPlan,
  ): Promise<SignalConsumeResult> {
    switch (plan.kind) {
      case 'RETURN':
        return plan.result;
      case 'RECORD':
        await this.persist(
          signal,
          plan.status,
          plan.transactionId ?? null,
          plan.reason,
          plan.duplicateOfTransactionId,
          plan.evidence,
        );
        return plan.result;
      case 'REVERSE':
        return this.applyReversal(signal, plan.originalId, plan.metadata);
      case 'CARD_PAYMENT':
        return this.applyCardPayment(signal, plan.payment);
      case 'IMPORT':
        return this.applyImport(signal, plan.draft);
    }
  }

  private describeImportPlan(plan: ImportPlan): SignalImportPreview {
    switch (plan.kind) {
      case 'RETURN':
        return {
          outcome: plan.result.outcome,
          reason: plan.result.reason,
          domainReferences: plan.result.domainReferences,
        };
      case 'RECORD':
        return {
          outcome: plan.result.outcome,
          reason: plan.result.reason,
          domainReferences: plan.result.domainReferences,
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

  private async applyImport(
    signal: RoutedSignal,
    draft: ImportDraft,
  ): Promise<SignalConsumeResult> {
    try {
      let transactionId: string;
      if (draft.cashAccountId) {
        const result = await this.importTransaction.executeAtmWithdrawal(
          signal.userId,
          { ...draft.input, cashAccountId: draft.cashAccountId },
        );
        if (!result?.debit?.id) {
          return this.review({ signal, reason: 'ATM_WITHDRAWAL_NOT_IMPORTED' });
        }
        transactionId = result.debit.id;
      } else {
        const created = draft.transfer
          ? await this.importTransaction.executeUnpairedTransfer(
              signal.userId,
              draft.input,
            )
          : await this.importTransaction.execute(signal.userId, draft.input);
        transactionId = created.id;
      }
      await this.persist(signal, 'IMPORTED', transactionId);
      if (!draft.input.linkedTransactionId && !draft.transfer) {
        await this.retryPendingReversals(signal.userId);
      }
      if (draft.transfer) {
        await this.tryPairTransfer(signal.userId, transactionId);
      }
      return this.result('APPLIED', transactionId);
    } catch (error) {
      const partialReversalOutcome = await this.partialReversalFailureOutcome({
        signal,
        error,
      });
      if (partialReversalOutcome) {
        return partialReversalOutcome;
      }
      const code = (error as { code?: string }).code;
      if (code === 'P2002') {
        const priorTransaction =
          await this.ledger.findTransactionByImportReference(
            signal.signalId,
            signal.userId,
          );
        if (priorTransaction) {
          await this.persist(signal, 'IMPORTED', priorTransaction.id);
          return this.result('ALREADY_APPLIED', priorTransaction.id);
        }
        if (draft.input.externalReference) {
          const existing = await this.ledger.findTransactionByExternalReference(
            signal.userId,
            draft.input.externalReference,
          );
          if (existing) {
            await this.persist(
              signal,
              'DUPLICATE',
              null,
              undefined,
              existing.id,
            );
            return this.result('ALREADY_APPLIED', existing.id);
          }
        }
      }
      throw error;
    }
  }

  private async partialReversalFailureOutcome({
    signal,
    error,
  }: {
    signal: RoutedSignal;
    error: unknown;
  }): Promise<SignalConsumeResult | null> {
    if (error instanceof PartialReversalAlreadyAppliedError) {
      await this.persist(
        signal,
        'DUPLICATE',
        null,
        undefined,
        error.transactionId,
      );
      return this.result('ALREADY_APPLIED', error.transactionId);
    }
    if (error instanceof PartialReversalAlreadyReversedError) {
      await this.persist(signal, 'REVERSED', error.originalId);
      return this.result('ALREADY_APPLIED', error.originalId);
    }
    if (error instanceof PartialReversalExceedsOriginalError) {
      return this.review({
        signal,
        reason: REVERSAL_REVIEW_REASON.EXCEEDS_ORIGINAL,
        evidence: { candidateTransactionIds: [error.originalId] },
      });
    }
    if (error instanceof PartialReversalNotApplicableError) {
      return this.review({
        signal,
        reason: error.reason,
        evidence: { candidateTransactionIds: [error.originalId] },
      });
    }
    return null;
  }

  private validationReason(candidate: Candidate): string | null {
    return financeValidationReviewReasons(candidate)[0] ?? null;
  }

  private movementClass(candidate: Candidate): MovementClass {
    if (candidate.movementClass) {
      return candidate.movementClass;
    }
    if (candidate.direction === 'CREDIT') {
      return 'INCOME';
    }
    return 'PURCHASE';
  }

  private transactionType(
    candidate: Candidate,
    movementClass: MovementClass,
  ): 'DEBIT' | 'CREDIT' {
    if (
      movementClass === 'TRANSFER_OUT' ||
      movementClass === 'ATM_WITHDRAWAL'
    ) {
      return 'DEBIT';
    }
    if (movementClass === 'TRANSFER_IN') {
      return 'CREDIT';
    }
    return candidate.direction === 'CREDIT' ? 'CREDIT' : 'DEBIT';
  }

  private resolveTransferTarget({
    candidate,
    movementClass,
    accounts,
  }: {
    candidate: Candidate;
    movementClass: MovementClass;
    accounts: TransferAccountCandidate[];
  }):
    | { kind: 'resolved'; accountId: string; leg: TransferLegIdentity | null }
    | { kind: 'review'; reason: string; evidence: ImportReviewEvidence } {
    const resolution = resolveTransferAccount({
      accountNumberHint: candidate.accountNumberLast4 ?? null,
      hasCardLast4Hint: Boolean(candidate.last4),
      accounts,
    });
    if (resolution.kind !== 'unique') {
      return {
        kind: 'review',
        reason: resolution.reason,
        evidence: {
          accountNumberHint: candidate.accountNumberLast4 ?? null,
          cardLast4Hint: candidate.last4 ?? null,
          ...(resolution.kind === 'ambiguous'
            ? { candidateAccountIds: resolution.candidateAccountIds }
            : {}),
        },
      };
    }
    return {
      kind: 'resolved',
      accountId: resolution.accountId,
      leg: transferLegIdentity(movementClass),
    };
  }

  private async classifyAgainstSharedReference({
    userId,
    bankReference,
    incoming,
  }: {
    userId: string;
    bankReference: string;
    incoming: IncomingTransferLeg;
  }): Promise<TransferImportDecision> {
    // A terminal status must not hide a replay of the same leg.
    const referenceMatches = await this.prisma.finTransaction.findMany({
      where: {
        userId,
        externalReference: bankReference,
      },
      select: {
        id: true,
        type: true,
        accountId: true,
        amount: true,
        currency: true,
        transactionDate: true,
      },
      orderBy: { transactionDate: 'desc' },
    });
    return classifyTransferImport({ incoming, existing: referenceMatches });
  }

  private async buildReversalPlan(
    signal: RoutedSignal,
    candidate: Candidate,
  ): Promise<ImportPlan> {
    const decision = await this.resolveReversal(signal.userId, candidate);
    if (decision.kind === 'review') {
      return this.reviewPlan(
        decision.reason,
        this.reversalEvidence(candidate, decision),
      );
    }
    const original = decision.original;
    if (decision.kind === 'already_reversed') {
      return {
        kind: 'RECORD',
        status: 'REVERSED',
        transactionId: original.id,
        result: this.result('ALREADY_APPLIED', original.id),
      };
    }
    const evidence = {
      ...this.reversalEvidence(candidate, decision),
      reversalOriginalId: original.id,
    };
    const repeatedOrExcess = await this.repeatedOrExcessReversalPlan({
      signal,
      candidate,
      original,
      evidence,
    });
    if (repeatedOrExcess) {
      return repeatedOrExcess;
    }
    if (decision.kind === 'partial') {
      return this.partialReversalPlan({
        signal,
        candidate,
        original,
        evidence,
      });
    }
    return {
      kind: 'REVERSE',
      originalId: original.id,
      metadata: { ...this.originalMetadata(original), ...evidence },
    };
  }

  /** A repeated refund is idempotent; one that exceeds the purchase needs a person. */
  private async repeatedOrExcessReversalPlan({
    signal,
    candidate,
    original,
    evidence,
  }: {
    signal: RoutedSignal;
    candidate: Candidate;
    original: ReversalOriginal;
    evidence: ImportReviewEvidence;
  }): Promise<ImportPlan | null> {
    const repeatedRefund =
      await this.ledger.findImportedTransactionByEmailMessageId(
        signal.userId,
        signal.sourceId,
      );
    if (
      repeatedRefund &&
      repeatedRefund.type === 'CREDIT' &&
      repeatedRefund.linkedTransactionId === original.id
    ) {
      return this.duplicatePlan(repeatedRefund.id, evidence);
    }
    const priorRefundTotal = await this.ledger.findLinkedRefundTotal({
      userId: signal.userId,
      originalId: original.id,
      currency: original.currency,
    });
    if (
      toMoney(priorRefundTotal)
        .plus(toMoney(candidate.amount!))
        .greaterThan(toMoney(original.amount))
    ) {
      return this.reviewPlan(REVERSAL_REVIEW_REASON.EXCEEDS_ORIGINAL, {
        ...evidence,
        candidateTransactionIds: [original.id],
      });
    }
    return null;
  }

  private partialReversalPlan({
    signal,
    candidate,
    original,
    evidence,
  }: {
    signal: RoutedSignal;
    candidate: Candidate;
    original: ReversalOriginal;
    evidence: ImportReviewEvidence;
  }): ImportPlan {
    const merchantMissing = !candidate.merchant;
    return {
      kind: 'IMPORT',
      draft: {
        cashAccountId: null,
        transfer: false,
        input: {
          accountId: original.accountId ?? undefined,
          cardId: original.cardId ?? undefined,
          importReference: signal.signalId,
          externalReference: candidate.bankReference ?? null,
          amount: candidate.amount!,
          currency: candidate.currency!,
          merchant: candidate.merchant ?? UNKNOWN_MERCHANT,
          merchantIsPlaceholder: merchantMissing,
          description: 'Reverso parcial',
          transactionDate: new Date(candidate.transactionDate!),
          type: 'CREDIT',
          status: 'CONFIRMED',
          categoryId: original.categoryId ?? undefined,
          linkedTransactionId: original.id,
          sourceEmailMessageId: signal.sourceId,
          aiMetadata: {
            ...evidence,
            reversalSignalId: signal.signalId,
            reversalSourceEmailMessageId: signal.sourceId,
            merchantMissing,
          },
        },
      },
    };
  }

  private async applyReversal(
    signal: RoutedSignal,
    originalId: string,
    metadata: Record<string, unknown>,
  ): Promise<SignalConsumeResult> {
    await this.reverseTransaction.execute(signal.userId, originalId, {
      ...metadata,
      reversalSignalId: signal.signalId,
      reversalSourceEmailMessageId: signal.sourceId,
    });
    await this.persist(signal, 'REVERSED', originalId);
    return this.result('APPLIED', originalId);
  }

  private async resolveReversal(
    userId: string,
    candidate: Candidate,
  ): Promise<ReversalTargetDecision> {
    const reversalAmount = candidate.amount!;
    const reversalCurrency = candidate.currency!;
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
      return this.reversalReview(
        'CANDIDATE',
        REVERSAL_REVIEW_REASON.COMMERCE_MISSING,
      );
    }
    if (!candidate.transactionDate) {
      return this.reversalReview(
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

  private reversalReview(
    step: ReversalTargetDecision['step'],
    reason: ReversalReviewReason,
  ): ReversalTargetDecision {
    return { kind: 'review', step, reason, candidateIds: [] };
  }

  private reversalEvidence(
    candidate: Candidate,
    decision: ReversalTargetDecision,
  ): ImportReviewEvidence {
    return {
      reversalReference: candidate.reverseOfBankReference ?? null,
      reverseOfEmailMessageId: candidate.reverseOfEmailMessageId ?? null,
      reversalStep: decision.step,
      reversalAmount: candidate.amount ?? null,
      candidateTransactionIds:
        decision.kind === 'review' && decision.candidateIds.length > 0
          ? decision.candidateIds
          : null,
    };
  }

  private originalMetadata(
    original: ReversalOriginal,
  ): Record<string, unknown> {
    return original.aiMetadata &&
      typeof original.aiMetadata === 'object' &&
      !Array.isArray(original.aiMetadata)
      ? (original.aiMetadata as Record<string, unknown>)
      : {};
  }

  /** Retries reversals after an imported email makes a missing original available. */
  private async retryPendingReversals(userId: string): Promise<void> {
    const pending = await this.prisma.finSignalImport.findMany({
      where: {
        userId,
        status: 'REVIEW_REQUIRED',
        reviewReason: {
          in: [
            REVERSAL_REVIEW_REASON.ORIGINAL_NOT_FOUND,
            REVERSAL_REVIEW_REASON.REFERENCE_NOT_FOUND,
          ],
        },
      },
      select: {
        signalId: true,
        sourceEmailMessageId: true,
        createdAt: true,
        candidate: true,
      },
      orderBy: { updatedAt: 'asc' },
      take: PENDING_REVERSAL_RETRY_LIMIT,
    });
    for (const row of pending) {
      const parsed = payloadSchema.safeParse(row.candidate);
      const candidate = parsed.success ? parsed.data.transaction : null;
      if (!candidate) {
        continue;
      }
      const signal = this.pendingSignal(userId, row);
      try {
        const plan = await this.buildReversalPlan(signal, candidate);
        await this.applyImportPlan(signal, plan);
      } catch (error) {
        this.logger.warn(
          `Reversal retry failed for signal ${row.signalId}: ${(error as { code?: string }).code ?? 'UNKNOWN'}`,
        );
      }
    }
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
      signalType: 'FINANCE.TRANSACTION_DETECTED',
      schemaVersion: 1,
      occurredAt: row.createdAt.toISOString(),
      sourceType: 'EMAIL_MESSAGE',
      sourceId: row.sourceEmailMessageId,
      payload: {},
    };
  }

  private returnPlan(result: SignalConsumeResult): ImportPlan {
    return { kind: 'RETURN', result };
  }

  private importedPlan(transactionId: string): ImportPlan {
    return {
      kind: 'RECORD',
      status: 'IMPORTED',
      transactionId,
      result: this.result('ALREADY_APPLIED', transactionId),
    };
  }

  private duplicatePlan(
    transactionId: string,
    evidence?: ImportReviewEvidence,
  ): ImportPlan {
    return {
      kind: 'RECORD',
      status: 'DUPLICATE',
      duplicateOfTransactionId: transactionId,
      evidence,
      result: this.result('ALREADY_APPLIED', transactionId),
    };
  }

  private failedPlan(reason: string): ImportPlan {
    return {
      kind: 'RECORD',
      status: 'FAILED',
      reason,
      result: { outcome: 'REJECTED', domainReferences: [], reason },
    };
  }

  private reviewPlan(
    reason: string,
    evidence?: ImportReviewEvidence,
  ): ImportPlan {
    return {
      kind: 'RECORD',
      status: 'REVIEW_REQUIRED',
      reason,
      evidence,
      result: { outcome: 'REVIEW_REQUIRED', domainReferences: [], reason },
    };
  }

  private importMetadata({
    signal,
    payload,
    candidate,
    movementClass,
    amount,
    currency,
  }: {
    signal: RoutedSignal;
    payload: z.infer<typeof payloadSchema>;
    candidate: Candidate;
    movementClass: MovementClass;
    amount: number;
    currency: string;
  }) {
    return {
      signalId: signal.signalId,
      sourceEmailMessageId: signal.sourceId,
      signalType: signal.signalType,
      signalSchemaVersion: signal.schemaVersion,
      semanticType: payload.semanticType ?? null,
      confidence: payload.confidence ?? null,
      movementClass,
      bankStatusNormalized: candidate.bankStatusNormalized ?? 'UNKNOWN',
      statusConfidence: candidate.statusConfidence ?? payload.confidence ?? 0,
      statusEvidence: candidate.statusEvidence ?? null,
      suggestedTransactionDate: candidate.suggestedTransactionDate ?? null,
      suggestedTransactionDateSource:
        candidate.suggestedTransactionDateSource ?? null,
      originalAmount: amount,
      originalCurrency: currency,
      sourceReceivedAmount: candidate.receivedAmount ?? null,
      sourceExchangeRate: candidate.transferExchangeRate ?? null,
    };
  }

  /**
   * Pago de tarjeta confirmado: dos patas `CARD_PAYMENT`, sin gasto. Solo aplica
   * una vez; un pago manual parecido se vincula como duplicado y la duda va a
   * revisión.
   */
  private async buildCardPaymentPlan({
    signal,
    payload,
    candidate,
    accounts,
    status,
  }: {
    signal: RoutedSignal;
    payload: z.infer<typeof payloadSchema>;
    candidate: Candidate;
    accounts: readonly {
      id: string;
      accountNumberLast4: string | null;
      currency: string;
    }[];
    status: FinTransactionStatusValue;
  }): Promise<ImportPlan> {
    if (status !== 'CONFIRMED') {
      return this.reviewPlan('CARD_PAYMENT_NOT_CONFIRMED');
    }
    const amount = candidate.amount!;
    const currency = candidate.currency!;
    const transactionDate = new Date(candidate.transactionDate!);

    const card = await this.resolveCardPaymentCard({
      userId: signal.userId,
      lastFour: candidate.last4 ?? null,
    });
    if (card.kind === 'review') {
      return this.reviewPlan(card.reason);
    }
    const account = this.resolveCardPaymentAccount({
      accounts,
      accountNumberLast4: candidate.accountNumberLast4 ?? null,
    });
    if (account.kind === 'review') {
      return this.reviewPlan(account.reason);
    }
    if (!card.currencies.includes(currency)) {
      return this.reviewPlan('CARD_CURRENCY_MISSING');
    }

    const payment: ImportCardPaymentInput = {
      sourceAccountId: account.accountId,
      sourceAccountCurrency: account.currency,
      cardId: card.cardId,
      amount,
      currency,
      transactionDate,
      externalReference: candidate.bankReference ?? null,
      importReference: signal.signalId,
      aiMetadata: this.importMetadata({
        signal,
        payload,
        candidate,
        movementClass: 'CARD_PAYMENT',
        amount,
        currency,
      }),
      description: candidate.merchant ?? 'Pago de tarjeta',
      notes: null,
      status,
    };
    const decision = await this.cardPaymentImport.preview(
      signal.userId,
      payment,
    );
    if (decision.kind === 'duplicate') {
      return this.duplicatePlan(decision.transactionId);
    }
    if (decision.kind === 'conflict' || decision.kind === 'ambiguous') {
      return this.reviewPlan(decision.reason, {
        externalReference: candidate.bankReference ?? null,
        candidateTransactionIds: decision.candidateTransactionIds,
      });
    }
    return { kind: 'CARD_PAYMENT', payment };
  }

  private async applyCardPayment(
    signal: RoutedSignal,
    payment: ImportCardPaymentInput,
  ): Promise<ConsumeResult> {
    const imported = await this.cardPaymentImport.execute(
      signal.userId,
      payment,
    );
    if (imported.kind === 'review') {
      return this.review({
        signal,
        reason: imported.reason,
        evidence: {
          externalReference: payment.externalReference,
          candidateTransactionIds: imported.candidateTransactionIds,
        },
      });
    }
    if (imported.kind === 'duplicate') {
      await this.persist(
        signal,
        'DUPLICATE',
        null,
        undefined,
        imported.sourceTransactionId,
      );
      return this.result('ALREADY_APPLIED', imported.sourceTransactionId);
    }
    if (imported.kind === 'not_written') {
      return this.review({ signal, reason: 'CARD_PAYMENT_NOT_IMPORTED' });
    }
    await this.persist(signal, 'IMPORTED', imported.sourceTransactionId);
    return this.result('APPLIED', imported.sourceTransactionId);
  }

  private async resolveCardPaymentCard({
    userId,
    lastFour,
  }: {
    userId: string;
    lastFour: string | null;
  }): Promise<
    | { kind: 'resolved'; cardId: string; currencies: string[] }
    | { kind: 'review'; reason: string }
  > {
    if (!lastFour) {
      return { kind: 'review', reason: 'CARD_PAYMENT_CARD_NOT_FOUND' };
    }
    const cards = await this.prisma.finCard.findMany({
      where: { userId, isActive: true },
      select: {
        id: true,
        type: true,
        lastFour: true,
        balances: { select: { currency: true } },
      },
    });
    const matches = cards.filter((card) => card.lastFour === lastFour);
    if (matches.length === 0) {
      return { kind: 'review', reason: 'CARD_PAYMENT_CARD_NOT_FOUND' };
    }
    if (matches.length > 1) {
      return { kind: 'review', reason: 'CARD_PAYMENT_CARD_AMBIGUOUS' };
    }
    if (matches[0].type !== 'CREDIT') {
      return { kind: 'review', reason: 'CARD_PAYMENT_CARD_NOT_CREDIT' };
    }
    return {
      kind: 'resolved',
      cardId: matches[0].id,
      currencies: matches[0].balances.map(({ currency }) => currency),
    };
  }

  private resolveCardPaymentAccount({
    accounts,
    accountNumberLast4,
  }: {
    accounts: readonly {
      id: string;
      accountNumberLast4: string | null;
      currency: string;
    }[];
    accountNumberLast4: string | null;
  }):
    | { kind: 'resolved'; accountId: string; currency: string }
    | { kind: 'review'; reason: string } {
    if (!accountNumberLast4) {
      return {
        kind: 'review',
        reason: 'CARD_PAYMENT_SOURCE_ACCOUNT_NOT_FOUND',
      };
    }
    const matches = accounts.filter((account) =>
      accountMatchesHint(account.accountNumberLast4, accountNumberLast4),
    );
    if (matches.length === 0) {
      return {
        kind: 'review',
        reason: 'CARD_PAYMENT_SOURCE_ACCOUNT_NOT_FOUND',
      };
    }
    if (matches.length > 1) {
      return {
        kind: 'review',
        reason: 'CARD_PAYMENT_SOURCE_ACCOUNT_AMBIGUOUS',
      };
    }
    return {
      kind: 'resolved',
      accountId: matches[0].id,
      currency: matches[0].currency,
    };
  }

  private async review({
    signal,
    reason,
    evidence,
  }: {
    signal: RoutedSignal;
    reason: string;
    evidence?: ImportReviewEvidence;
  }) {
    await this.persist(
      signal,
      'REVIEW_REQUIRED',
      null,
      reason,
      undefined,
      evidence,
    );
    return {
      outcome: 'REVIEW_REQUIRED' as const,
      domainReferences: [],
      reason,
    };
  }

  private async persist(
    signal: RoutedSignal,
    status: ImportStatus,
    transactionId: string | null,
    reviewReason?: string,
    duplicateOfTransactionId?: string | null,
    reviewEvidence?: ImportReviewEvidence,
  ) {
    await this.prisma.finSignalImport.upsert({
      where: {
        userId_signalId: { userId: signal.userId, signalId: signal.signalId },
      },
      create: {
        userId: signal.userId,
        signalId: signal.signalId,
        sourceEmailMessageId: signal.sourceId,
        status,
        reviewReason,
        transactionId,
        duplicateOfTransactionId,
        candidate: reviewEvidence
          ? { ...signal.payload, financeImportEvidence: reviewEvidence }
          : signal.payload,
      },
      update: {
        status,
        reviewReason,
        transactionId,
        duplicateOfTransactionId,
      },
    });
  }

  private fromStored(
    status: ImportStatus,
    reason: string | null,
    transactionId: string | null,
  ): SignalConsumeResult {
    if (status === 'REVIEW_REQUIRED') {
      return {
        outcome: 'REVIEW_REQUIRED',
        domainReferences: [],
        reason: reason ?? 'REVIEW_REQUIRED',
      };
    }
    if (status === 'FAILED') {
      return {
        outcome: 'REJECTED',
        domainReferences: [],
        reason: reason ?? 'SIGNAL_IMPORT_FAILED',
      };
    }
    return this.result('ALREADY_APPLIED', transactionId);
  }

  private result(
    outcome: 'APPLIED' | 'ALREADY_APPLIED',
    transactionId: string | null,
  ): SignalConsumeResult {
    return {
      outcome,
      domainReferences: transactionId
        ? [{ type: 'FinTransaction', id: transactionId }]
        : [],
    };
  }

  /**
   * La pata importada queda pendiente. Solo se empareja cuando hay un candidato
   * único; con varios, la pata sigue pendiente y el motivo queda en la evidencia.
   */
  private async tryPairTransfer(userId: string, transactionId: string) {
    const current = await this.prisma.finTransaction.findFirst({
      where: { id: transactionId, userId },
      include: pairingInstrumentInclude,
    });
    if (
      !current ||
      !current.transferGroupId ||
      !isTransferMovementClass(movementClassOf(current))
    ) {
      return;
    }
    const baseCurrency = await this.baseCurrency.execute(userId);
    const since = new Date(
      current.transactionDate.getTime() - REFERENCE_MATCH_WINDOW_MS,
    );
    const rows = await this.prisma.finTransaction.findMany({
      where: {
        userId,
        source: 'EMAIL',
        type: { in: ['DEBIT', 'CREDIT'] },
        status: { in: ['PENDING', 'CONFIRMED'] },
        transferGroupId: { not: null },
        transactionDate: { gte: since },
      },
      include: pairingInstrumentInclude,
      orderBy: { transactionDate: 'desc' },
      take: 100,
    });
    const groupIds = [
      ...new Set(
        rows
          .map((row) => row.transferGroupId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const groupRows =
      groupIds.length === 0
        ? []
        : await this.prisma.finTransaction.findMany({
            where: { userId, transferGroupId: { in: groupIds } },
            include: pairingInstrumentInclude,
          });
    const rowsById = new Map(rows.map((row) => [row.id, row] as const));
    for (const row of groupRows) {
      rowsById.set(row.id, row);
    }
    const allRows = [...rowsById.values()];
    const allCandidates = allRows.map((row) =>
      toTransferPairingCandidate(row, baseCurrency),
    );
    const candidates = allRows
      .filter((row) => row.source === 'EMAIL')
      .map((row) => toTransferPairingCandidate(row, baseCurrency));
    const unpaired = candidates.filter((row) =>
      isUnpairedTransferCandidate(row, allCandidates),
    );
    const currentCandidate = candidates.find((row) => row.id === transactionId);
    if (
      !currentCandidate ||
      !isUnpairedTransferCandidate(currentCandidate, allCandidates)
    ) {
      return;
    }
    const { match, candidateIds } = pickTransferMatch(
      currentCandidate,
      unpaired,
    );
    if (match) {
      const debitId =
        currentCandidate.type === 'DEBIT' ? currentCandidate.id : match.id;
      const creditId =
        currentCandidate.type === 'CREDIT' ? currentCandidate.id : match.id;
      await this.importTransaction.pairTransferLegs(userId, debitId, creditId);
      return;
    }
    if (candidateIds.length > 1) {
      await this.recordPairingEvidence({
        transactionId,
        currentMetadata: current.aiMetadata,
        candidateIds,
      });
    }
  }

  private async recordPairingEvidence({
    transactionId,
    currentMetadata,
    candidateIds,
  }: {
    transactionId: string;
    currentMetadata: unknown;
    candidateIds: string[];
  }): Promise<void> {
    const metadata =
      currentMetadata &&
      typeof currentMetadata === 'object' &&
      !Array.isArray(currentMetadata)
        ? (currentMetadata as Record<string, unknown>)
        : {};
    await this.prisma.finTransaction.update({
      where: { id: transactionId },
      data: {
        aiMetadata: {
          ...metadata,
          transferPairing: {
            reason: 'TRANSFER_PAIR_AMBIGUOUS',
            candidateTransactionIds: candidateIds,
          },
        },
      },
    });
  }
}

function toTransferPairingCandidate(
  row: PairingTransactionRow,
  baseCurrency: string,
): ImportTransferCandidate {
  return {
    id: row.id,
    type: row.type,
    externalReference: row.externalReference,
    amount: row.amountBaseCurrency,
    currency: baseCurrency,
    transactionDate: row.transactionDate,
    transferGroupId: row.transferGroupId,
    categoryId: row.categoryId,
    description: row.description,
    merchant: row.merchant,
    notes: row.notes,
    aiMetadata: row.aiMetadata,
    account: row.account,
    card: row.card,
  };
}

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
