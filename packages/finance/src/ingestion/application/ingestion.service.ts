import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  clampPageLimit,
  toCursorPage,
  type CursorQueryDto,
} from '@personal-os/core';
import { ImportEmailTransactionUseCase } from '../../ledger/application/import-email-transaction.use-case';
import { LedgerQueryService } from '../../ledger/application/ledger-query.service';
import { MerchantsService } from '../../merchants/application/merchants.service';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { resolveCategoryIdForImport } from '../../shared/domain/category-type';
import { mapBankStatusToInternal } from '../../shared/domain/transaction-status';
import { buildEmailImportNotes } from './build-email-import-notes';
import { EMAIL_MESSAGE_OUTCOME } from './email-message-outcome';
import { isAtmMovementClass, isTransferMovementClass } from './email-movement';
import { uniqueCashAccountId } from './match-email-transfers';
import { parseExtractedPayload } from './parse-extracted-email';
import type { ExtractedEmailTransaction } from './ports/email-transaction-extractor.port';
import {
  FinancialImportCandidatesPort,
  type AssignFinancialCandidateCommand,
  type FinancialImportCandidate,
} from './ports/financial-import-candidates.port';
import { resolveEmailLedgerTarget } from './resolve-email-ledger-target';
type PendingMessageRow = FinancialImportCandidate;
type AssignEmailMessageDto = AssignFinancialCandidateCommand;
@Injectable()
export class IngestionService {
  constructor(
    private readonly repo: FinancialImportCandidatesPort,
    private readonly ownership: FinanceOwnershipService,
    private readonly importEmail: ImportEmailTransactionUseCase,
    private readonly ledger: LedgerQueryService,
    private readonly merchants: MerchantsService,
  ) {}
  private async findMerchantCategoryId(
    userId: string,
    merchant: string,
  ): Promise<string | null> {
    const suggestion = await this.merchants.suggest(userId, merchant);
    return suggestion?.categoryId ?? null;
  }
  async listPendingAssignment(userId: string, query: CursorQueryDto) {
    const rows = await this.repo.listPendingAssignmentCandidatesPage(
      userId,
      query,
    );
    const page = toCursorPage(rows, clampPageLimit(query.limit), (row) =>
      row.createdAt.toISOString(),
    );
    return {
      ...page,
      items: page.items.map((row) => this.mapPendingMessage(row)),
    };
  }
  async listRecentMessages(userId: string, query: CursorQueryDto) {
    const rows = await this.repo.listRecentCandidatesPage(userId, query);
    const page = toCursorPage(rows, clampPageLimit(query.limit), (row) =>
      row.createdAt.toISOString(),
    );
    return {
      ...page,
      items: page.items.map((row) => ({
        ...this.mapPendingMessage(row),
        outcome: row.outcome,
      })),
    };
  }
  async assignPendingMessage(
    userId: string,
    messageId: string,
    dto: AssignEmailMessageDto,
  ) {
    const message = await this.repo.findCandidateById(userId, messageId);
    if (!message) {
      throw new NotFoundException('Mensaje de correo no encontrado');
    }

    if (
      message.outcome === EMAIL_MESSAGE_OUTCOME.IMPORTED &&
      message.transaction
    ) {
      return { assigned: true as const, transactionId: message.transaction.id };
    }
    if (
      message.outcome !== EMAIL_MESSAGE_OUTCOME.PENDING_ASSIGNMENT &&
      message.outcome !== EMAIL_MESSAGE_OUTCOME.PENDING_AMOUNT
    ) {
      throw new BadRequestException(
        'El mensaje de correo no está pendiente de asignación',
      );
    }

    await this.assertAssignmentTarget(
      userId,
      message.source.institutionId,
      dto,
    );
    return this.importPendingMessage(userId, message, {
      accountId: dto.accountId,
      cardId: dto.cardId,
      amount: dto.amount,
    });
  }
  async retryPendingMessage(userId: string, messageId: string) {
    const message = await this.repo.findCandidateById(userId, messageId);
    if (!message) {
      throw new NotFoundException('Mensaje de correo no encontrado');
    }
    if (
      message.outcome === EMAIL_MESSAGE_OUTCOME.IMPORTED &&
      message.transaction
    ) {
      return { assigned: true as const, transactionId: message.transaction.id };
    }
    if (
      message.outcome !== EMAIL_MESSAGE_OUTCOME.PENDING_ASSIGNMENT &&
      message.outcome !== EMAIL_MESSAGE_OUTCOME.PENDING_AMOUNT
    ) {
      throw new BadRequestException(
        'El mensaje de correo no está pendiente de asignación',
      );
    }

    const [accounts, cards] = await this.repo.listInstitutionDestinations(
      userId,
      message.source.institutionId,
    );
    const extracted = parseExtractedPayload(message.extractedPayload);
    const movementClass = extracted?.movementClass ?? null;
    const match = resolveEmailLedgerTarget({
      instrumentHint:
        message.instrumentHint === 'ACCOUNT' ||
        message.instrumentHint === 'CARD'
          ? message.instrumentHint
          : null,
      lastFourHint: message.lastFourHint,
      accountNumberHint: message.accountNumberHint,
      accounts,
      cards,
      allowDefaultAccount:
        !isTransferMovementClass(movementClass) &&
        !isAtmMovementClass(movementClass),
    });
    if (match.kind !== 'unique') {
      return this.mapPendingMessage(message);
    }
    return this.importPendingMessage(userId, message, {
      accountId: match.accountId,
      cardId: match.cardId,
    });
  }
  async completePendingAmount(
    userId: string,
    messageId: string,
    amount: number,
  ) {
    const message = await this.repo.findCandidateById(userId, messageId);
    if (!message) {
      throw new NotFoundException('Mensaje de correo no encontrado');
    }
    if (
      message.outcome === EMAIL_MESSAGE_OUTCOME.IMPORTED &&
      message.transaction
    ) {
      return { assigned: true as const, transactionId: message.transaction.id };
    }
    if (message.outcome !== EMAIL_MESSAGE_OUTCOME.PENDING_AMOUNT) {
      throw new BadRequestException(
        'Email message is not waiting for an amount',
      );
    }
    if (!(amount > 0)) {
      throw new BadRequestException('el monto debe ser positivo');
    }

    const [accounts, cards] = await this.repo.listInstitutionDestinations(
      userId,
      message.source.institutionId,
    );
    const extracted = parseExtractedPayload(message.extractedPayload);
    const movementClass = extracted?.movementClass ?? null;
    const match = resolveEmailLedgerTarget({
      instrumentHint:
        message.instrumentHint === 'ACCOUNT' ||
        message.instrumentHint === 'CARD'
          ? message.instrumentHint
          : null,
      lastFourHint: message.lastFourHint,
      accountNumberHint: message.accountNumberHint,
      accounts,
      cards,
      allowDefaultAccount:
        !isTransferMovementClass(movementClass) &&
        !isAtmMovementClass(movementClass),
    });
    if (match.kind !== 'unique') {
      await this.repo.persistCandidate({
        userId,
        sourceId: message.sourceId,
        sourceReference: message.sourceReference,
        outcome: EMAIL_MESSAGE_OUTCOME.PENDING_ASSIGNMENT,
        reason:
          match.kind === 'ambiguous'
            ? `Ambiguous ledger target (${match.candidateCount})`
            : 'No matching account or card',
        provider: message.provider,
        model: message.model,
        instrumentHint: message.instrumentHint,
        lastFourHint: message.lastFourHint,
        accountNumberHint: message.accountNumberHint,
        extractedPayload: {
          ...(extracted ?? {}),
          amount,
        },
      });
      const updated = await this.repo.findCandidateById(userId, messageId);
      return this.mapPendingMessage(updated ?? message);
    }
    return this.importPendingMessage(userId, message, {
      accountId: match.accountId,
      cardId: match.cardId,
      amount,
    });
  }
  private async importPendingMessage(
    userId: string,
    message: PendingMessageRow,
    target: { accountId?: string; cardId?: string; amount?: number },
  ) {
    const extracted = parseExtractedPayload(message.extractedPayload);
    if (!extracted) {
      throw new BadRequestException(
        'El mensaje de correo no tiene extracción para asignar',
      );
    }
    const amount = target.amount ?? extracted.amount;
    if (amount == null) {
      throw new BadRequestException('Al mensaje de correo le falta el monto');
    }

    const status = mapBankStatusToInternal({
      bankStatusNormalized: extracted.bankStatusNormalized,
      statusConfidence: extracted.statusConfidence,
    });
    const skipCategory =
      isTransferMovementClass(extracted.movementClass) ||
      isAtmMovementClass(extracted.movementClass);

    if (isAtmMovementClass(extracted.movementClass)) {
      const cashAccountId = uniqueCashAccountId(
        await this.repo.listCashAccounts(userId),
      );
      if (!cashAccountId) {
        throw new BadRequestException(
          'ATM withdrawal needs a single CASH account',
        );
      }
      const notes = buildEmailImportNotes({
        llmNotes: extracted.notes,
        categoryId: null,
        categorySource: null,
        status,
        skipUncategorizedWarning: true,
      });
      const created = await this.importEmail.executeAtmWithdrawal(userId, {
        accountId: target.accountId,
        cardId: target.cardId,
        cashAccountId,
        importReference: message.id,
        amount,
        currency: extracted.currency,
        merchant: extracted.merchant,
        description: extracted.description,
        notes,
        transactionDate: new Date(extracted.transactionDate),
        type: 'DEBIT',
        status,
        aiMetadata: {
          movementClass: extracted.movementClass,
          assignedAt: new Date().toISOString(),
        },
      });
      await this.markImported(userId, message, { ...extracted, amount, notes });
      return {
        assigned: true as const,
        transactionId: created?.debit.id ?? message.id,
      };
    }

    const categories = await this.repo.listCategories(userId);
    const category = skipCategory
      ? { categoryId: null, source: null }
      : await resolveCategoryIdForImport({
          categories,
          hint: extracted.categoryNameHint,
          transactionType: extracted.type,
          merchant: extracted.merchant,
          findMerchantCategoryId: (merchant) =>
            this.findMerchantCategoryId(userId, merchant),
          findCategoryIdByMerchant: (merchant) =>
            this.ledger.findLatestCategoryIdByMerchant(userId, merchant),
        });
    const notes = buildEmailImportNotes({
      llmNotes: extracted.notes,
      categoryId: category.categoryId,
      categorySource: category.source,
      categoryNameHint: extracted.categoryNameHint,
      status,
      skipUncategorizedWarning: skipCategory,
    });

    const importInput = {
      accountId: target.accountId,
      cardId: target.cardId,
      importReference: message.id,
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
        movementClass: extracted.movementClass,
        bankStatusRaw: extracted.bankStatusRaw,
        bankStatusNormalized: extracted.bankStatusNormalized,
        statusEvidence: extracted.statusEvidence,
        statusConfidence: extracted.statusConfidence,
        assignedAt: new Date().toISOString(),
      },
    };
    const created = skipCategory
      ? await this.importEmail.executeUnpairedTransfer(userId, importInput)
      : await this.importEmail.execute(userId, importInput);

    await this.markImported(userId, message, { ...extracted, amount, notes });
    return { assigned: true as const, transactionId: created.id };
  }
  private markImported(
    userId: string,
    message: PendingMessageRow,
    extracted: ExtractedEmailTransaction,
  ) {
    return this.repo.persistCandidate({
      userId,
      sourceId: message.sourceId,
      sourceReference: message.sourceReference,
      outcome: EMAIL_MESSAGE_OUTCOME.IMPORTED,
      provider: message.provider,
      model: message.model,
      instrumentHint: message.instrumentHint,
      lastFourHint: message.lastFourHint,
      accountNumberHint: message.accountNumberHint,
      extractedPayload: extracted,
    });
  }
  private async assertAssignmentTarget(
    userId: string,
    institutionId: string,
    dto: AssignEmailMessageDto,
  ) {
    if (dto.accountId) {
      const account = await this.ownership.assertAccountOwned(
        userId,
        dto.accountId,
      );
      if (account.institutionId !== institutionId) {
        throw new BadRequestException(
          'Account does not belong to this institution',
        );
      }
      if (!account.isActive) {
        throw new BadRequestException('La cuenta no está activa');
      }
    }
    if (dto.cardId) {
      const card = await this.ownership.assertCardOwned(userId, dto.cardId);
      if (card.institutionId !== institutionId) {
        throw new BadRequestException(
          'Card does not belong to this institution',
        );
      }
      if (!card.isActive) {
        throw new BadRequestException('La tarjeta no está activa');
      }
    }
  }
  private parseExtractedPayload(
    payload: unknown,
  ): ExtractedEmailTransaction | null {
    return parseExtractedPayload(payload);
  }
  private mapPendingMessage(row: PendingMessageRow) {
    return {
      id: row.id,
      sourceId: row.sourceId,
      sourceReference: row.sourceReference,
      institutionId: row.source.institutionId,
      institutionName: row.source.institution.name,

      instrumentHint: row.instrumentHint,
      lastFourHint: row.lastFourHint,
      accountNumberHint: row.accountNumberHint,
      extractedPayload: row.extractedPayload,
      outcome: row.outcome,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
