import { Injectable } from '@nestjs/common';
import type { RoutedSignal } from '@personal-os/contracts';
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
import { ImportFinancialTransactionUseCase } from '../ledger/application/import-financial-transaction.use-case';
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
type ImportReviewEvidence = Record<string, string | string[] | number | null>;

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
    if (signal.signalType !== 'FINANCE.TRANSACTION_DETECTED') {
      return {
        outcome: 'REJECTED' as const,
        domainReferences: [],
        reason: 'UNSUPPORTED_FINANCE_SIGNAL',
      };
    }

    const prior = await this.prisma.finSignalImport.findUnique({
      where: {
        userId_signalId: { userId: signal.userId, signalId: signal.signalId },
      },
    });
    if (prior) {
      return this.fromStored(
        prior.status,
        prior.reviewReason,
        prior.transactionId ?? prior.duplicateOfTransactionId,
      );
    }

    const existingTransaction =
      await this.ledger.findTransactionByImportReference(
        signal.signalId,
        signal.userId,
      );
    if (existingTransaction) {
      await this.persist(signal, 'IMPORTED', existingTransaction.id);
      return this.result('ALREADY_APPLIED', existingTransaction.id);
    }

    const parsed = payloadSchema.safeParse(signal.payload);
    if (!parsed.success) {
      await this.persist(signal, 'FAILED', null, 'INVALID_SIGNAL_PAYLOAD');
      return {
        outcome: 'REJECTED' as const,
        domainReferences: [],
        reason: 'INVALID_SIGNAL_PAYLOAD',
      };
    }
    const payload = parsed.data;
    const candidate = payload.transaction;
    if (!candidate || candidate.kind === 'NOT_TRANSACTION') {
      await this.persist(signal, 'FAILED', null, 'NO_TRANSACTION_CANDIDATE');
      return {
        outcome: 'REJECTED' as const,
        domainReferences: [],
        reason: 'NO_TRANSACTION_CANDIDATE',
      };
    }

    if (
      payload.relevance === false ||
      !payload.routes?.includes('FINANCE') ||
      (payload.confidence ?? 0) < REVIEW_CONFIDENCE_THRESHOLD
    ) {
      return this.review({ signal, reason: 'LOW_CONFIDENCE_OR_NOT_FINANCE' });
    }

    const validationReason = this.validationReason(candidate);
    if (validationReason) {
      return this.review({
        signal,
        reason: validationReason,
        evidence:
          validationReason === 'TRANSACTION_DATE_SUGGESTED'
            ? {
                suggestedTransactionDate:
                  candidate.suggestedTransactionDate ?? null,
                suggestedTransactionDateSource:
                  candidate.suggestedTransactionDateSource ?? null,
              }
            : undefined,
      });
    }

    const movementClass = this.movementClass(candidate);
    if (
      candidate.direction === 'TRANSFER' &&
      !isTransferMovementClass(movementClass)
    ) {
      return this.review({ signal, reason: 'TRANSFER_DIRECTION_AMBIGUOUS' });
    }
    if (isTransferMovementClass(movementClass) && !candidate.direction) {
      return this.review({ signal, reason: 'TRANSFER_SIDE_MISSING' });
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
        return this.review({
          signal,
          reason: transferTarget.reason,
          evidence: transferTarget.evidence,
        });
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
        return this.review({
          signal,
          reason:
            ledgerTarget.kind === 'ambiguous'
              ? 'AMBIGUOUS_LEDGER_TARGET'
              : 'NO_LEDGER_TARGET',
          evidence:
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
        });
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
      return this.reverse(signal, payload, candidate);
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
        await this.persist(
          signal,
          'DUPLICATE',
          null,
          undefined,
          decision.transactionId,
        );
        return this.result('ALREADY_APPLIED', decision.transactionId);
      }
      if (decision.kind === 'conflict') {
        return this.review({
          signal,
          reason: decision.reason,
          evidence: {
            externalReference: candidate.bankReference,
            candidateTransactionIds: decision.candidateTransactionIds,
          },
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
        await this.persist(signal, 'DUPLICATE', null, undefined, duplicate.id);
        return this.result('ALREADY_APPLIED', duplicate.id);
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

    try {
      let transactionId: string;
      if (isAtmMovementClass(movementClass)) {
        const cashAccounts = await this.prisma.finAccount.findMany({
          where: { userId: signal.userId, isActive: true, type: 'CASH' },
          select: { id: true },
        });
        const cashAccountId = uniqueCashAccountId(cashAccounts);
        if (!cashAccountId) {
          return this.review({ signal, reason: 'ATM_CASH_ACCOUNT_AMBIGUOUS' });
        }
        const result = await this.importTransaction.executeAtmWithdrawal(
          signal.userId,
          {
            accountId: target.accountId,
            cardId: target.cardId,
            cashAccountId,
            importReference: signal.signalId,
            amount,
            currency,
            merchant: candidate.merchant ?? null,
            description: candidate.merchant ?? 'Retiro en cajero',
            notes,
            transactionDate,
            type: 'DEBIT',
            status,
            aiMetadata,
          },
        );
        if (!result?.debit?.id) {
          return this.review({ signal, reason: 'ATM_WITHDRAWAL_NOT_IMPORTED' });
        }
        transactionId = result.debit.id;
      } else {
        const importInput = {
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
        };
        const created = transfer
          ? await this.importTransaction.executeUnpairedTransfer(
              signal.userId,
              importInput,
            )
          : await this.importTransaction.execute(signal.userId, importInput);
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
        if (candidate.bankReference) {
          const existing = await this.ledger.findTransactionByExternalReference(
            signal.userId,
            candidate.bankReference,
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

  private async reverse(
    signal: RoutedSignal,
    payload: z.infer<typeof payloadSchema>,
    candidate: Candidate,
  ) {
    const original = await this.ledger.findTransactionByExternalReference(
      signal.userId,
      candidate.reverseOfBankReference ?? candidate.bankReference ?? '',
    );
    if (!original) {
      return this.review({ signal, reason: 'REVERSAL_ORIGINAL_NOT_FOUND' });
    }
    if (original.status === 'REVERSED') {
      await this.persist(signal, 'REVERSED', original.id);
      return this.result('ALREADY_APPLIED', original.id);
    }
    const metadata =
      original.aiMetadata &&
      typeof original.aiMetadata === 'object' &&
      !Array.isArray(original.aiMetadata)
        ? (original.aiMetadata as Record<string, unknown>)
        : {};
    await this.reverseTransaction.execute(signal.userId, original.id, {
      ...metadata,
      reversalSignalId: signal.signalId,
      reversalSourceEmailMessageId: signal.sourceId,
    });
    await this.persist(signal, 'REVERSED', original.id);
    return this.result('APPLIED', original.id);
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
    duplicateOfTransactionId?: string,
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
  ) {
    if (status === 'REVIEW_REQUIRED') {
      return {
        outcome: 'REVIEW_REQUIRED' as const,
        domainReferences: [],
        reason: reason ?? 'REVIEW_REQUIRED',
      };
    }
    if (status === 'FAILED') {
      return {
        outcome: 'REJECTED' as const,
        domainReferences: [],
        reason: reason ?? 'SIGNAL_IMPORT_FAILED',
      };
    }
    return this.result('ALREADY_APPLIED', transactionId);
  }

  private result(
    outcome: 'APPLIED' | 'ALREADY_APPLIED',
    transactionId: string | null,
  ) {
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
