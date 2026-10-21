import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';
import type { Env } from '@personal-os/config';
import {
  AppEvents,
  clampPageLimit,
  toCursorPage,
  type CursorQueryDto,
} from '@personal-os/core';
import { UsersService } from '@personal-os/users';
import type { DomainEventPublisherPort } from '../../events/application/ports/domain-event-publisher.port';
import { FinanceOutboxDispatcher } from '../../events/infrastructure/finance-outbox.dispatcher';
import { ImportEmailTransactionUseCase } from '../../ledger/application/import-email-transaction.use-case';
import { LedgerQueryService } from '../../ledger/application/ledger-query.service';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { DOMAIN_EVENT_PUBLISHER } from '../../shared/application/tokens';
import { resolveCategoryIdForImport } from '../../shared/domain/category-type';
import { mapBankStatusToInternal } from '../../shared/domain/transaction-status';
import { EmailSourceRepository } from '../infrastructure/email-source.repository';
import {
  exchangeGoogleAuthCode,
  fetchGoogleUserEmail,
  getGmailMessageFromHeader,
  listGmailMessages,
  refreshGoogleAccessToken,
} from '../infrastructure/gmail-api.util';
import {
  decryptToken,
  encryptToken,
} from '../infrastructure/token-encryption.util';
import type { ConnectEmailSourceDto } from '../presentation/dto/connect-email-source.dto';
import type {
  AssignEmailMessageDto,
  GoogleOAuthUrlQueryDto,
} from '../presentation/dto/oauth-callback-query.dto';
import type { UpdateEmailSourceDto } from '../presentation/dto/update-email-source.dto';
import {
  extractEmailAddress,
  extractEmailDomain,
  normalizeBankSenderEmails,
} from './bank-sender';
import { buildEmailImportNotes } from './build-email-import-notes';
import { isAtmMovementClass, isTransferMovementClass } from './email-movement';
import { EmailSourceService } from './email-source.service';
import {
  mapEmailSourceResponse,
  resolveSenderFields,
} from './email-source-view';
import { GmailSyncQueueService } from './gmail-sync-queue.service';
import { EMAIL_MESSAGE_OUTCOME } from './email-message-outcome';
import { uniqueCashAccountId } from './match-email-transfers';
import {
  buildFallbackWebOAuthRedirect,
  buildMobileOAuthRedirect,
  buildWebOAuthRedirect,
  isAllowlistedReturnTo,
} from './oauth-client-redirect';
import { parseExtractedPayload } from './parse-extracted-email';
import type { ExtractedEmailTransaction } from './ports/email-transaction-extractor.port';
import { resolveEmailLedgerTarget } from './resolve-email-ledger-target';

type OAuthStatePayload = {
  sub: string;
  institutionId?: string;
  bankDomain?: string;
  bankSenderEmail?: string;
  label?: string;
  returnTo?: string;
};

type PendingMessageRow = Awaited<
  ReturnType<EmailSourceRepository['listPendingAssignmentMessages']>
>[number];

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly repo: EmailSourceRepository,
    private readonly config: ConfigService<Env, true>,
    @Inject(DOMAIN_EVENT_PUBLISHER)
    private readonly events: DomainEventPublisherPort,
    private readonly outboxDispatcher: FinanceOutboxDispatcher,
    private readonly users: UsersService,
    private readonly ownership: FinanceOwnershipService,
    private readonly importEmail: ImportEmailTransactionUseCase,
    private readonly ledger: LedgerQueryService,
    private readonly emailSources: EmailSourceService,
    private readonly gmailSyncQueue: GmailSyncQueueService,
  ) {}

  listEmailSources(userId: string) {
    return this.emailSources.listEmailSources(userId);
  }

  listMailboxes(userId: string) {
    return this.emailSources.listMailboxes(userId);
  }

  deactivateMailbox(userId: string, id: string) {
    return this.emailSources.deactivateMailbox(userId, id);
  }

  createEmailSource(userId: string, dto: ConnectEmailSourceDto) {
    return this.emailSources.createEmailSource(userId, dto);
  }

  updateEmailSource(userId: string, id: string, dto: UpdateEmailSourceDto) {
    return this.emailSources.updateEmailSource(userId, id, dto);
  }

  deactivateEmailSource(userId: string, id: string) {
    return this.emailSources.deactivateEmailSource(userId, id);
  }

  async triggerEmailSync(
    userId: string,
    sourceId: string,
    forceFullSync = false,
  ) {
    await this.users.assertFinanceEmailSyncEnabled(userId);
    const source = await this.repo.findEmailSource(userId, sourceId);
    if (!source) {
      throw new NotFoundException('Origen de correo no encontrado');
    }
    // El sync manual deduplica por origen: un reintento tras un timeout no
    // encola un segundo sync mientras el primero siga en vuelo.
    return this.gmailSyncQueue.enqueue(userId, sourceId, { forceFullSync });
  }

  async completeEmailSyncSuccessWithEvent(params: {
    logId: string;
    userId: string;
    sourceId: string;
    emailsScanned: number;
    transactionsNew: number;
    transactionIds: string[];
    countsByStatus: Record<string, number>;
  }) {
    const eventId = randomUUID();
    const occurredAt = new Date().toISOString();
    await this.repo.completeEmailSyncSuccessWithOutbox(
      params.logId,
      {
        status: 'SUCCESS',
        emailsScanned: params.emailsScanned,
        transactionsNew: params.transactionsNew,
      },
      {
        eventId,
        eventName: AppEvents.FINANCE_EMAIL_SYNC_COMPLETED,
        aggregateType: 'FinEmailSource',
        aggregateId: params.sourceId,
        userId: params.userId,
        payload: {
          sourceId: params.sourceId,
          emailsScanned: params.emailsScanned,
          transactionsNew: params.transactionsNew,
          transactionIds: params.transactionIds,
          countsByStatus: params.countsByStatus,
          occurredAt,
          version: 1,
        },
      },
    );
    void this.outboxDispatcher.processBatch();
  }

  async completeEmailSyncFailureWithEvent({
    logId,
    userId,
    sourceId,
    emailsScanned,
    transactionsNew,
    error,
  }: {
    logId: string;
    userId: string;
    sourceId: string;
    emailsScanned: number;
    transactionsNew: number;
    error: string;
  }) {
    const eventId = randomUUID();
    const occurredAt = new Date().toISOString();
    await this.repo.completeEmailSyncFailureWithOutbox({
      id: logId,
      emailsScanned,
      transactionsNew,
      error,
      outbox: {
        eventId,
        eventName: AppEvents.FINANCE_EMAIL_SYNC_FAILED,
        aggregateType: 'FinEmailSource',
        aggregateId: sourceId,
        userId,
        payload: {
          sourceId,
          error,
          emailsScanned,
          transactionsNew,
          occurredAt,
          version: 1,
        },
      },
    });
    void this.outboxDispatcher.processBatch();
  }

  /** @deprecated Prefer completeEmailSyncSuccessWithEvent (same TX). */
  async publishEmailSyncCompleted(event: {
    userId: string;
    sourceId: string;
    emailsScanned: number;
    transactionsNew: number;
    transactionIds: string[];
    countsByStatus: Record<string, number>;
  }) {
    await this.events.enqueue({
      eventName: AppEvents.FINANCE_EMAIL_SYNC_COMPLETED,
      aggregateType: 'FinEmailSource',
      aggregateId: event.sourceId,
      userId: event.userId,
      payload: {
        sourceId: event.sourceId,
        emailsScanned: event.emailsScanned,
        transactionsNew: event.transactionsNew,
        transactionIds: event.transactionIds,
        countsByStatus: event.countsByStatus,
      },
    });
    void this.outboxDispatcher.processBatch();
  }

  async enqueueCardStatementReminder(
    userId: string,
    input: { sourceId: string; gmailMessageId: string; subject: string },
  ) {
    await this.events.enqueue({
      eventName: AppEvents.FINANCE_CARD_STATEMENT_REMINDER,
      aggregateType: 'FinEmailSource',
      aggregateId: input.sourceId,
      userId,
      payload: {
        sourceId: input.sourceId,
        gmailMessageId: input.gmailMessageId,
        subject: input.subject,
        occurredAt: new Date().toISOString(),
        version: 1,
      },
    });
    void this.outboxDispatcher.processBatch();
  }

  async getGoogleOAuthUrl(
    userId: string,
    query: GoogleOAuthUrlQueryDto,
  ): Promise<{ url: string }> {
    await this.users.assertFinanceEmailSyncEnabled(userId);
    if (query.institutionId) {
      await this.ownership.assertInstitutionOwned(userId, query.institutionId);
    }

    const corsOrigin = this.config.get('CORS_ORIGIN', { infer: true });
    const returnTo = query.returnTo?.trim();
    if (returnTo && !isAllowlistedReturnTo(returnTo, corsOrigin)) {
      throw new BadRequestException('returnTo no es un origen permitido');
    }

    const sender = query.bankSenderEmail
      ? resolveSenderFields({
          bankSenderEmail: query.bankSenderEmail,
          bankDomain: query.bankDomain,
        })
      : {
          bankSenderEmails: [] as string[],
          bankDomain: query.bankDomain?.trim() || undefined,
        };

    const state = jwt.sign(
      {
        sub: userId,
        institutionId: query.institutionId,
        bankDomain:
          sender.bankDomain || (query.institutionId ? 'bhd.com.do' : undefined),
        bankSenderEmail: sender.bankSenderEmails[0],
        label: query.label?.trim() || undefined,
        returnTo: returnTo || undefined,
      } satisfies OAuthStatePayload,
      this.oauthStateSecret,
      { expiresIn: '15m' },
    );

    const params = new URLSearchParams({
      client_id: this.config.get('GOOGLE_CLIENT_ID', { infer: true }),
      redirect_uri: this.config.get('GOOGLE_REDIRECT_URI', { infer: true }),
      response_type: 'code',
      scope:
        'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email',
      access_type: 'offline',
      prompt: 'consent',
      state,
    });

    return {
      url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    };
  }

  resolveOAuthClientRedirect(
    state: string | undefined,
    success: boolean,
  ): string {
    const corsOrigin = this.config.get('CORS_ORIGIN', { infer: true });
    const payload = this.peekOAuthState(state);
    if (payload?.returnTo) {
      const web = buildWebOAuthRedirect(payload.returnTo, corsOrigin, success);
      if (web) {
        return web;
      }
    }
    return (
      buildFallbackWebOAuthRedirect(corsOrigin, success) ??
      buildMobileOAuthRedirect(success)
    );
  }

  private peekOAuthState(state: string | undefined): OAuthStatePayload | null {
    if (!state) {
      return null;
    }
    try {
      return jwt.verify(state, this.oauthStateSecret) as OAuthStatePayload;
    } catch {
      return null;
    }
  }

  async handleGoogleOAuthCallback(code: string, state: string) {
    let payload: OAuthStatePayload;
    try {
      payload = jwt.verify(state, this.oauthStateSecret) as OAuthStatePayload;
    } catch {
      throw new BadRequestException('State de OAuth inválido o vencido');
    }

    await this.users.assertFinanceEmailSyncEnabled(payload.sub);
    if (payload.institutionId) {
      await this.ownership.assertInstitutionOwned(
        payload.sub,
        payload.institutionId,
      );
    }

    const tokenResponse = await exchangeGoogleAuthCode(
      code,
      this.config.get('GOOGLE_CLIENT_ID', { infer: true }),
      this.config.get('GOOGLE_CLIENT_SECRET', { infer: true }),
      this.config.get('GOOGLE_REDIRECT_URI', { infer: true }),
    );

    const emailAddress = await fetchGoogleUserEmail(tokenResponse.access_token);
    const encryptedAccess = encryptToken(
      tokenResponse.access_token,
      this.encryptionKey,
    );
    const refreshToken = tokenResponse.refresh_token;
    if (!refreshToken) {
      throw new BadRequestException('Google no devolvió un refresh token');
    }
    const encryptedRefresh = encryptToken(refreshToken, this.encryptionKey);
    const tokenExpiresAt = new Date(
      Date.now() + tokenResponse.expires_in * 1000,
    );

    const existingConnection = await this.repo.findConnectionByUserEmail(
      payload.sub,
      'gmail',
      emailAddress,
    );
    const connection = existingConnection
      ? await this.repo.updateConnectionTokens(existingConnection.id, {
          accessToken: encryptedAccess,
          refreshToken: encryptedRefresh,
          tokenExpiresAt,
          emailAddress,
          isActive: true,
        })
      : await this.repo.createConnection(payload.sub, {
          provider: 'gmail',
          emailAddress,
          accessToken: encryptedAccess,
          refreshToken: encryptedRefresh,
          tokenExpiresAt,
          isActive: true,
        });

    if (!payload.institutionId) {
      return;
    }

    const sender = resolveSenderFields({
      bankSenderEmail: payload.bankSenderEmail,
      bankDomain: payload.bankDomain,
    });
    await this.emailSources.upsertInstitutionSource(payload.sub, {
      connectionId: connection.id,
      institutionId: payload.institutionId,
      bankSenderEmails: sender.bankSenderEmails,
      bankDomain: sender.bankDomain,
      label: payload.label,
    });
  }

  async getValidGmailAccessToken(sourceId: string): Promise<string> {
    const source = await this.repo.findEmailSourceForRefresh(sourceId);
    if (!source?.connection.accessToken) {
      throw new NotFoundException(
        'No se encontraron los tokens del origen de correo',
      );
    }

    const expiresSoon =
      !source.connection.tokenExpiresAt ||
      source.connection.tokenExpiresAt.getTime() - Date.now() < 5 * 60 * 1000;

    if (expiresSoon) {
      return this.refreshGmailToken(sourceId);
    }

    return decryptToken(source.connection.accessToken, this.encryptionKey);
  }

  async listPendingAssignment(userId: string, query: CursorQueryDto) {
    const rows = await this.repo.listPendingAssignmentMessagesPage(
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
    const rows = await this.repo.listRecentEmailMessagesPage(userId, query);
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
    await this.users.assertFinanceEmailSyncEnabled(userId);
    const message = await this.repo.findEmailMessageById(userId, messageId);
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
    await this.users.assertFinanceEmailSyncEnabled(userId);
    const message = await this.repo.findEmailMessageById(userId, messageId);
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
    await this.users.assertFinanceEmailSyncEnabled(userId);
    const message = await this.repo.findEmailMessageById(userId, messageId);
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
      await this.repo.upsertEmailMessage({
        sourceId: message.sourceId,
        gmailMessageId: message.gmailMessageId,
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
      const updated = await this.repo.findEmailMessageById(userId, messageId);
      return this.mapPendingMessage(updated ?? message);
    }
    return this.importPendingMessage(userId, message, {
      accountId: match.accountId,
      cardId: match.cardId,
      amount,
    });
  }

  async listDiscoveredSenders(userId: string, sourceId: string, days = 14) {
    const source = await this.repo.findEmailSource(userId, sourceId);
    if (!source) {
      throw new NotFoundException('Origen de correo no encontrado');
    }
    const accessToken = await this.getValidGmailAccessToken(sourceId);
    const query = `from:${source.bankDomain} newer_than:${Math.max(1, days)}d`;
    const known = new Set(
      normalizeBankSenderEmails({
        bankSenderEmails: source.bankSenderEmails,
      }),
    );
    const discovered = new Map<string, number>();
    let pageToken: string | undefined;
    let scanned = 0;
    do {
      const page = await listGmailMessages(accessToken, query, pageToken);
      for (const ref of page.messages) {
        scanned += 1;
        if (scanned > 80) {
          break;
        }
        const raw = await getGmailMessageFromHeader(accessToken, ref.id);
        const email = extractEmailAddress(raw);
        if (!email || known.has(email)) {
          continue;
        }
        if (extractEmailDomain(email) !== source.bankDomain) {
          continue;
        }
        discovered.set(email, (discovered.get(email) ?? 0) + 1);
      }
      if (scanned > 80) {
        break;
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    return [...discovered.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([email, count]) => ({ email, count }));
  }

  async addSourceSenders(userId: string, sourceId: string, emails: string[]) {
    const source = await this.repo.findEmailSource(userId, sourceId);
    if (!source) {
      throw new NotFoundException('Origen de correo no encontrado');
    }
    const sender = resolveSenderFields({
      bankSenderEmails: [...(source.bankSenderEmails ?? []), ...emails],
      bankDomain: source.bankDomain,
    });
    const updated = await this.repo.updateEmailSource(userId, sourceId, {
      bankSenderEmails: sender.bankSenderEmails,
      bankDomain: sender.bankDomain,
    });
    if (!updated) {
      throw new NotFoundException('Origen de correo no encontrado');
    }
    return mapEmailSourceResponse(updated);
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
        emailMessageId: message.id,
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
      await this.markImported(message, { ...extracted, amount, notes });
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
      emailMessageId: message.id,
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

    await this.markImported(message, { ...extracted, amount, notes });
    return { assigned: true as const, transactionId: created.id };
  }

  private markImported(
    message: PendingMessageRow,
    extracted: ExtractedEmailTransaction,
  ) {
    return this.repo.upsertEmailMessage({
      sourceId: message.sourceId,
      gmailMessageId: message.gmailMessageId,
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

  private async refreshGmailToken(sourceId: string): Promise<string> {
    const source = await this.repo.findEmailSourceForRefresh(sourceId);
    if (!source?.connection.refreshToken || !source.connection.accessToken) {
      throw new NotFoundException(
        'No se encontraron los tokens del origen de correo',
      );
    }

    const refreshToken = decryptToken(
      source.connection.refreshToken,
      this.encryptionKey,
    );
    const tokenResponse = await refreshGoogleAccessToken(
      refreshToken,
      this.config.get('GOOGLE_CLIENT_ID', { infer: true }),
      this.config.get('GOOGLE_CLIENT_SECRET', { infer: true }),
    );

    const encryptedAccess = encryptToken(
      tokenResponse.access_token,
      this.encryptionKey,
    );
    const tokenExpiresAt = new Date(
      Date.now() + tokenResponse.expires_in * 1000,
    );

    await this.repo.updateConnectionTokens(source.connection.id, {
      accessToken: encryptedAccess,
      refreshToken: source.connection.refreshToken,
      tokenExpiresAt,
    });

    return tokenResponse.access_token;
  }

  private get encryptionKey(): string {
    return this.config.get('ENCRYPTION_KEY', { infer: true });
  }

  private get oauthStateSecret(): string {
    const secret = this.config.get('OAUTH_STATE_SECRET', { infer: true });
    if (secret) {
      return secret;
    }

    const nodeEnv = this.config.get('NODE_ENV', { infer: true });
    if (nodeEnv === 'production') {
      throw new Error('OAUTH_STATE_SECRET is required in production');
    }

    this.logger.warn(
      'OAUTH_STATE_SECRET is not set; falling back to ENCRYPTION_KEY (non-production only)',
    );
    return this.encryptionKey;
  }

  private mapPendingMessage(row: PendingMessageRow) {
    return {
      id: row.id,
      sourceId: row.sourceId,
      gmailMessageId: row.gmailMessageId,
      institutionId: row.source.institutionId,
      institutionName: row.source.institution.name,
      emailAddress: row.source.connection.emailAddress,
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
