import { Injectable } from '@nestjs/common';
import type { RoutedSignal, SignalImportPreview } from '@personal-os/contracts';
import { PrismaService } from '@personal-os/database';
import { z } from 'zod';
import { buildFinancialImportNotes } from '../ledger/application/build-import-notes';
import {
  MOVEMENT_CLASSES,
  isAtmMovementClass,
  isTransferMovementClass,
  type MovementClass,
} from '../ledger/domain/movement-class';
import {
  isUnpairedTransferCandidate,
  pickTransferMatch,
  type ImportTransferCandidate,
  uniqueCashAccountId,
} from '../ledger/application/match-imported-transfers';
import { resolveLedgerTargetFromHints } from '../ledger/application/resolve-ledger-target-from-hints';
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
  ImportFinancialTransactionUseCase,
  type ImportFinancialMovementInput,
} from '../ledger/application/import-financial-transaction.use-case';
import { LedgerQueryService } from '../ledger/application/ledger-query.service';
import { ReverseTransactionUseCase } from '../ledger/application/reverse-transaction.use-case';
import { MerchantsService } from '../merchants/application/merchants.service';
import { ResolveUserBaseCurrencyUseCase } from '../fx/application/resolve-user-base-currency';
import { resolveCategoryIdForImport } from '../shared/domain/category-type';
import { mapBankStatusToInternal } from '../shared/domain/transaction-status';
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
type ImportReviewEvidence = Record<string, string | string[] | number | null>;

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
  | { kind: 'IMPORT'; draft: ImportDraft };

@Injectable()
export class FinanceSignalConsumer implements FinanceSignalConsumerPort {
  readonly domain = 'FINANCE';

  constructor(
    private readonly prisma: PrismaService,
    private readonly importTransaction: ImportFinancialTransactionUseCase,
    private readonly ledger: LedgerQueryService,
    private readonly reverseTransaction: ReverseTransactionUseCase,
    private readonly merchants: MerchantsService,
    private readonly baseCurrency: ResolveUserBaseCurrencyUseCase,
  ) {}

  async consume(signal: RoutedSignal) {
    const plan = await this.buildImportPlan(signal);
    return this.applyImportPlan(signal, plan);
  }

  /** Igual que `consume`, pero sin escribir ni señales ni ledger. */
  async preview(signal: RoutedSignal): Promise<SignalImportPreview> {
    const plan = await this.buildImportPlan(signal);
    return this.describeImportPlan(plan);
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
      },
    });
    const activeCards = await this.prisma.finCard.findMany({
      where: { userId: signal.userId, isActive: true },
      select: { id: true, lastFour: true },
    });
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
    const aiMetadata = {
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
          merchant: candidate.merchant ?? null,
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
      return this.result('APPLIED', transactionId);
    } catch (error) {
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

  private validationReason(candidate: Candidate): string | null {
    if (candidate.kind === 'NOT_TRANSACTION') {
      return 'NOT_A_TRANSACTION';
    }
    if (candidate.amount == null) {
      return 'AMOUNT_MISSING';
    }
    if (!candidate.currency) {
      return 'CURRENCY_MISSING';
    }
    if (!candidate.transactionDate) {
      if (
        candidate.suggestedTransactionDate &&
        candidate.suggestedTransactionDateSource === 'EMAIL_HEADER' &&
        !Number.isNaN(Date.parse(candidate.suggestedTransactionDate))
      ) {
        return 'TRANSACTION_DATE_SUGGESTED';
      }
      return 'TRANSACTION_DATE_MISSING';
    }
    if (Number.isNaN(Date.parse(candidate.transactionDate))) {
      return 'TRANSACTION_DATE_MISSING';
    }
    if (
      !candidate.direction ||
      (candidate.direction === 'TRANSFER' &&
        candidate.movementClass !== 'TRANSFER_OUT' &&
        candidate.movementClass !== 'TRANSFER_IN')
    ) {
      return 'DIRECTION_MISSING';
    }
    return null;
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
    const original = await this.ledger.findTransactionByExternalReference(
      signal.userId,
      candidate.reverseOfBankReference ?? candidate.bankReference ?? '',
    );
    if (!original) {
      return this.reviewPlan('REVERSAL_ORIGINAL_NOT_FOUND');
    }
    if (original.status === 'REVERSED') {
      return {
        kind: 'RECORD',
        status: 'REVERSED',
        transactionId: original.id,
        result: this.result('ALREADY_APPLIED', original.id),
      };
    }
    const metadata =
      original.aiMetadata &&
      typeof original.aiMetadata === 'object' &&
      !Array.isArray(original.aiMetadata)
        ? (original.aiMetadata as Record<string, unknown>)
        : {};
    return { kind: 'REVERSE', originalId: original.id, metadata };
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

  private duplicatePlan(transactionId: string): ImportPlan {
    return {
      kind: 'RECORD',
      status: 'DUPLICATE',
      duplicateOfTransactionId: transactionId,
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

  /** Pairing stays out of the 334A slice; kept for the matching unit. */
  private async tryPairTransfer(userId: string, transactionId: string) {
    const current = await this.prisma.finTransaction.findFirst({
      where: { id: transactionId, userId },
      include: {
        account: { select: { institutionId: true, type: true } },
        card: { select: { institutionId: true } },
      },
    });
    if (!current || !current.transferGroupId) {
      return;
    }
    const baseCurrency = await this.baseCurrency.execute(userId);
    const since = new Date(current.transactionDate);
    since.setUTCDate(since.getUTCDate() - 3);
    const rows = await this.prisma.finTransaction.findMany({
      where: {
        userId,
        source: 'EMAIL',
        type: { in: ['DEBIT', 'CREDIT'] },
        status: { in: ['PENDING', 'CONFIRMED'] },
        transferGroupId: { not: null },
        transactionDate: { gte: since },
      },
      include: {
        account: { select: { institutionId: true, type: true } },
        card: { select: { institutionId: true } },
      },
      orderBy: { transactionDate: 'desc' },
      take: 100,
    });
    const candidates = rows.map((row) => ({
      id: row.id,
      type: row.type,
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
    })) as ImportTransferCandidate[];
    const unpaired = candidates.filter((row) =>
      isUnpairedTransferCandidate(row, candidates),
    );
    const currentCandidate = candidates.find((row) => row.id === transactionId);
    if (!currentCandidate) {
      return;
    }
    const match = pickTransferMatch(currentCandidate, unpaired);
    if (match) {
      const debitId =
        currentCandidate.type === 'DEBIT' ? currentCandidate.id : match.id;
      const creditId =
        currentCandidate.type === 'CREDIT' ? currentCandidate.id : match.id;
      await this.importTransaction.pairTransferLegs(userId, debitId, creditId);
    }
  }
}
