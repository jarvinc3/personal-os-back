import { Injectable } from '@nestjs/common';
import { ImportEmailTransactionUseCase } from '../../ledger/application/import-email-transaction.use-case';
import { LedgerQueryService } from '../../ledger/application/ledger-query.service';
import { resolveCategoryIdForImport } from '../../shared/domain/category-type';
import { mapBankStatusToInternal } from '../../shared/domain/transaction-status';
import { buildEmailImportNotes } from './build-email-import-notes';
import {
  isAtmMovementClass,
  isTransferMovementClass,
  type EmailMovementClass,
} from './email-movement';
import {
  EMAIL_MESSAGE_OUTCOME,
  type EmailMessageOutcome,
} from './email-message-outcome';
import { EmailSourceRepository } from '../infrastructure/email-source.repository';
import { uniqueCashAccountId } from './match-email-transfers';
import type { ExtractedEmailTransaction } from './ports/email-transaction-extractor.port';
import {
  resolveEmailLedgerTarget,
  type EmailLedgerTargetMatch,
} from './resolve-email-ledger-target';

export type RoutedEmailImport =
  | { kind: 'imported'; transactionId: string; status: string }
  | { kind: 'duplicate'; transactionId: string }
  | { kind: 'pending_assignment'; reason: string }
  | { kind: 'pending_amount'; reason: string }
  | { kind: 'pending_cash'; reason: string };

@Injectable()
export class RouteExtractedEmailUseCase {
  constructor(
    private readonly emailSources: EmailSourceRepository,
    private readonly importEmail: ImportEmailTransactionUseCase,
    private readonly ledger: LedgerQueryService,
  ) {}

  async execute(params: {
    userId: string;
    sourceId: string;
    gmailMessageId: string;
    emailMessageId?: string;
    extracted: ExtractedEmailTransaction;
    provider?: string | null;
    model?: string | null;
    accounts: Array<{
      id: string;
      accountNumberLast4: string | null;
      isDefaultForInstitution?: boolean;
    }>;
    cards: Array<{ id: string; lastFour: string | null }>;
    cashAccounts: Array<{ id: string }>;
    amountOverride?: number;
  }): Promise<RoutedEmailImport> {
    let extracted = {
      ...params.extracted,
      amount: params.amountOverride ?? params.extracted.amount,
    };
    const movementClass = extracted.movementClass;
    const match = resolveEmailLedgerTarget({
      instrumentHint: extracted.instrumentHint,
      lastFourHint: extracted.lastFourHint,
      accountNumberHint: extracted.accountNumberHint,
      accounts: params.accounts,
      cards: params.cards,
      allowDefaultAccount:
        !isTransferMovementClass(movementClass) &&
        !isAtmMovementClass(movementClass),
    });

    if (extracted.amount == null) {
      extracted = await this.suggestPayrollAmount({
        userId: params.userId,
        extracted,
        match,
      });
    }
    const amount = extracted.amount;
    if (amount == null) {
      await this.persist(
        params,
        extracted,
        EMAIL_MESSAGE_OUTCOME.PENDING_AMOUNT,
        'Missing amount',
      );
      return { kind: 'pending_amount', reason: 'Missing amount' };
    }

    if (match.kind !== 'unique') {
      const reason =
        match.kind === 'ambiguous'
          ? `Ambiguous ledger target (${match.candidateCount})`
          : 'No matching account or card';
      await this.persist(
        params,
        extracted,
        EMAIL_MESSAGE_OUTCOME.PENDING_ASSIGNMENT,
        reason,
      );
      return { kind: 'pending_assignment', reason };
    }

    const duplicate = await this.ledger.findDedupeCandidate(params.userId, {
      externalReference: extracted.bankReference,
      accountId: match.accountId,
      cardId: match.cardId,
      amount,
      currency: extracted.currency,
      type: extracted.type,
      merchant: extracted.merchant,
      transactionDate: new Date(extracted.transactionDate),
    });
    if (duplicate) {
      await this.persist(
        params,
        extracted,
        EMAIL_MESSAGE_OUTCOME.SKIPPED_DUPLICATE,
        `Duplicate of transaction ${duplicate.id}`,
      );
      return { kind: 'duplicate', transactionId: duplicate.id };
    }

    if (isAtmMovementClass(movementClass)) {
      return this.importAtm(
        params,
        { ...extracted, amount },
        match,
        movementClass,
      );
    }

    const categories = await this.emailSources.listCategories(params.userId);
    const status =
      (await this.emailSources.findEmailSyncMode(params.userId)) === 'PENDING'
        ? 'PENDING'
        : mapBankStatusToInternal({
            bankStatusNormalized: extracted.bankStatusNormalized,
            statusConfidence: extracted.statusConfidence,
          });
    const skipCategory = isTransferMovementClass(movementClass);
    const category = skipCategory
      ? { categoryId: null, source: null }
      : await resolveCategoryIdForImport({
          categories,
          hint: extracted.categoryNameHint,
          transactionType: extracted.type,
          merchant: extracted.merchant,
          findCategoryIdByMerchant: (merchant) =>
            this.ledger.findLatestCategoryIdByMerchant(params.userId, merchant),
        });
    const notes = buildEmailImportNotes({
      llmNotes: extracted.notes,
      categoryId: category.categoryId,
      categorySource: category.source,
      categoryNameHint: extracted.categoryNameHint,
      status,
      skipUncategorizedWarning: skipCategory,
    });
    const persisted = await this.persist(
      params,
      { ...extracted, notes },
      EMAIL_MESSAGE_OUTCOME.PENDING_ASSIGNMENT,
    );
    const possibleDuplicate = await this.ledger.findPossibleDuplicate(
      params.userId,
      {
        accountId: match.accountId,
        cardId: match.cardId,
        amount,
        currency: extracted.currency,
        type: extracted.type,
        transactionDate: new Date(extracted.transactionDate),
      },
    );
    const importInput = {
      accountId: match.accountId,
      cardId: match.cardId,
      emailMessageId: persisted.id,
      externalReference: extracted.bankReference,
      ...(possibleDuplicate
        ? { possibleDuplicateOfId: possibleDuplicate.id }
        : {}),
      amount,
      currency: extracted.currency,
      merchant: extracted.merchant,
      description: extracted.description,
      notes,
      transactionDate: new Date(extracted.transactionDate),
      type: extracted.type,
      status,
      categoryId: category.categoryId,
      aiMetadata: {
        movementClass,
        bankStatusRaw: extracted.bankStatusRaw,
        bankStatusNormalized: extracted.bankStatusNormalized,
        statusEvidence: extracted.statusEvidence,
        statusConfidence: extracted.statusConfidence,
        provider: params.provider,
        model: params.model,
        extractedAt: new Date().toISOString(),
      },
    };
    let created: { id: string };
    try {
      created = skipCategory
        ? await this.importEmail.executeUnpairedTransfer(
            params.userId,
            importInput,
          )
        : await this.importEmail.execute(params.userId, importInput);
    } catch (error) {
      const prismaError = error as { code?: string };
      if (prismaError.code === 'P2002' && extracted.bankReference) {
        const existing = await this.ledger.findTransactionByExternalReference(
          params.userId,
          extracted.bankReference,
        );
        if (existing) {
          await this.persist(
            params,
            { ...extracted, notes },
            EMAIL_MESSAGE_OUTCOME.SKIPPED_DUPLICATE,
            `Duplicate of transaction ${existing.id}`,
          );
          return { kind: 'duplicate', transactionId: existing.id };
        }
      }
      throw error;
    }

    await this.persist(
      params,
      { ...extracted, notes },
      EMAIL_MESSAGE_OUTCOME.IMPORTED,
    );
    return { kind: 'imported', transactionId: created.id, status };
  }

  /**
   * A payroll notice without an amount becomes a PENDING credit with the last
   * payroll amount as a suggestion, so the user only confirms it. It is never
   * dropped: without a previous payroll it stays in the pending-amount queue.
   */
  private async suggestPayrollAmount(params: {
    userId: string;
    extracted: ExtractedEmailTransaction;
    match: EmailLedgerTargetMatch;
  }): Promise<ExtractedEmailTransaction> {
    if (
      params.extracted.movementClass !== 'PAYROLL' ||
      params.match.kind !== 'unique' ||
      !params.match.accountId
    ) {
      return params.extracted;
    }
    const suggestedFixedIncome = await this.emailSources.findFixedIncomeAmount(
      params.userId,
    );
    const suggested =
      suggestedFixedIncome ??
      (await this.emailSources.findSuggestedPayrollAmount({
        userId: params.userId,
        accountId: params.match.accountId,
        currency: params.extracted.currency,
      }));
    if (suggested == null || suggested <= 0) {
      return params.extracted;
    }
    return {
      ...params.extracted,
      amount: suggested,
      notes: suggestedFixedIncome
        ? 'Monto de tu ingreso fijo; confírmalo.'
        : 'Monto sugerido de la nómina anterior; confírmalo.',
      bankStatusNormalized: 'PENDING',
      statusConfidence: 1,
    };
  }

  private async importAtm(
    params: {
      userId: string;
      sourceId: string;
      gmailMessageId: string;
      provider?: string | null;
      model?: string | null;
    },
    extracted: ExtractedEmailTransaction & { amount: number },
    match: { accountId?: string; cardId?: string },
    movementClass: EmailMovementClass,
  ): Promise<RoutedEmailImport> {
    const cashAccountId = uniqueCashAccountId(
      await this.emailSources.listCashAccounts(params.userId),
    );
    if (!cashAccountId) {
      const reason = 'ATM withdrawal needs a single CASH account';
      await this.persist(
        params,
        extracted,
        EMAIL_MESSAGE_OUTCOME.PENDING_ASSIGNMENT,
        reason,
      );
      return { kind: 'pending_cash', reason };
    }
    const status =
      (await this.emailSources.findEmailSyncMode(params.userId)) === 'PENDING'
        ? 'PENDING'
        : mapBankStatusToInternal({
            bankStatusNormalized: extracted.bankStatusNormalized,
            statusConfidence: extracted.statusConfidence,
          });
    const notes = buildEmailImportNotes({
      llmNotes: extracted.notes,
      categoryId: null,
      categorySource: null,
      status,
      skipUncategorizedWarning: true,
    });
    const persisted = await this.persist(
      params,
      { ...extracted, notes },
      EMAIL_MESSAGE_OUTCOME.PENDING_ASSIGNMENT,
    );
    const created = await this.importEmail.executeAtmWithdrawal(params.userId, {
      accountId: match.accountId,
      cardId: match.cardId,
      cashAccountId,
      emailMessageId: persisted.id,
      amount: extracted.amount,
      currency: extracted.currency,
      merchant: extracted.merchant,
      description: extracted.description,
      notes,
      transactionDate: new Date(extracted.transactionDate),
      type: 'DEBIT',
      status,
      aiMetadata: {
        movementClass,
        provider: params.provider,
        model: params.model,
        extractedAt: new Date().toISOString(),
      },
    });
    await this.persist(
      params,
      { ...extracted, notes },
      EMAIL_MESSAGE_OUTCOME.IMPORTED,
    );
    return {
      kind: 'imported',
      transactionId: created?.debit.id ?? persisted.id,
      status,
    };
  }

  private persist(
    params: {
      sourceId: string;
      gmailMessageId: string;
      provider?: string | null;
      model?: string | null;
    },
    extracted: ExtractedEmailTransaction,
    outcome: EmailMessageOutcome,
    reason?: string,
  ) {
    return this.emailSources.upsertEmailMessage({
      sourceId: params.sourceId,
      gmailMessageId: params.gmailMessageId,
      outcome,
      reason: reason ?? null,
      provider: params.provider,
      model: params.model,
      instrumentHint: extracted.instrumentHint,
      lastFourHint: extracted.lastFourHint,
      accountNumberHint: extracted.accountNumberHint,
      extractedPayload: extracted,
    });
  }
}
