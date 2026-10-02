import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';
import type { Env } from '../../../../config';
import { AppEvents } from '../../../../core/events/event.constants';
import type { GmailSyncJob } from '../../../../core/queues/queue-jobs';
import { QueueNames } from '../../../../core/queues/queue.constants';
import { UsersService } from '../../../users';
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
import { EMAIL_MESSAGE_OUTCOME } from './email-message-outcome';
import {
  GMAIL_SYNC_JOB_NAME,
  GMAIL_SYNC_JOB_OPTIONS,
  gmailSyncJobId,
} from './gmail-sync.constants';
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

type EmailSourceRow = Awaited<
  ReturnType<EmailSourceRepository['listEmailSources']>
>[number];

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
    @Optional()
    @InjectQueue(QueueNames.GMAIL_SYNC)
    private readonly gmailSyncQueue?: Queue<GmailSyncJob>,
  ) {}

  listEmailSources(userId: string) {
    return this.repo
      .listEmailSources(userId)
      .then((sources) => sources.map((s) => this.mapEmailSourceResponse(s)));
  }

  async listMailboxes(userId: string) {
    const rows = await this.repo.listMailboxes(userId);
    return rows.map((row) => ({
      id: row.id,
      emailAddress: row.emailAddress,
      provider: row.provider,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      sources: row.sources.map((source) => this.mapEmailSourceResponse(source)),
    }));
  }

  async deactivateMailbox(userId: string, id: string) {
    const updated = await this.repo.deactivateMailbox(userId, id);
    if (!updated) throw new NotFoundException('Mailbox not found');
    return { success: true };
  }

  async createEmailSource(userId: string, dto: ConnectEmailSourceDto) {
    await this.users.assertFinanceEmailSyncEnabled(userId);
    await this.ownership.assertInstitutionOwned(userId, dto.institutionId);

    const connection = await this.repo.findConnectionByUserEmail(
      userId,
      'gmail',
      dto.emailAddress,
    );
    if (!connection) {
      throw new NotFoundException('Connect Gmail before linking a bank');
    }
    if (!connection.refreshToken) {
      throw new BadRequestException('Connect Gmail first');
    }

    const sender = this.resolveSenderFields({
      bankSenderEmail: dto.bankSenderEmail,
      bankSenderEmails: dto.bankSenderEmails,
      bankDomain: dto.bankDomain,
    });
    return this.upsertInstitutionSource(userId, {
      connectionId: connection.id,
      institutionId: dto.institutionId,
      bankSenderEmails: sender.bankSenderEmails,
      bankDomain: sender.bankDomain,
      label: dto.label,
    });
  }

  async updateEmailSource(
    userId: string,
    id: string,
    dto: UpdateEmailSourceDto,
  ) {
    const existing = await this.repo.findEmailSource(userId, id);
    if (!existing) throw new NotFoundException('Email source not found');

    if (dto.institutionId) {
      await this.ownership.assertInstitutionOwned(userId, dto.institutionId);
      const linked = await this.repo.findSourceByUserAndInstitution(
        userId,
        dto.institutionId,
      );
      if (linked && linked.id !== id && linked.isActive) {
        throw new ConflictException(
          'This institution is already linked to a mailbox',
        );
      }
    }

    const data: Record<string, unknown> = {};
    if (dto.institutionId !== undefined) data.institutionId = dto.institutionId;
    if (dto.label !== undefined) data.label = dto.label;
    if (
      dto.bankSenderEmail !== undefined ||
      dto.bankSenderEmails !== undefined
    ) {
      const sender = this.resolveSenderFields({
        bankSenderEmail: dto.bankSenderEmail,
        bankSenderEmails: dto.bankSenderEmails,
        bankDomain: dto.bankDomain ?? existing.bankDomain,
      });
      data.bankSenderEmails = sender.bankSenderEmails;
      data.bankDomain = sender.bankDomain;
    } else if (dto.bankDomain !== undefined) {
      data.bankDomain = dto.bankDomain.trim();
    }

    const updated = await this.repo.updateEmailSource(userId, id, data);
    if (!updated) throw new NotFoundException('Email source not found');
    return this.mapEmailSourceResponse(updated);
  }

  async deactivateEmailSource(userId: string, id: string) {
    const updated = await this.repo.updateEmailSource(userId, id, {
      isActive: false,
    });
    if (!updated) throw new NotFoundException('Email source not found');
    return { success: true };
  }

  async triggerEmailSync(
    userId: string,
    sourceId: string,
    forceFullSync = false,
  ) {
    await this.users.assertFinanceEmailSyncEnabled(userId);
    const source = await this.repo.findEmailSource(userId, sourceId);
    if (!source) throw new NotFoundException('Email source not found');
    return this.enqueueGmailSyncJob(userId, sourceId, { forceFullSync });
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
      throw new BadRequestException('returnTo is not an allowed origin');
    }

    const sender = query.bankSenderEmail
      ? this.resolveSenderFields({
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
      if (web) return web;
    }
    return (
      buildFallbackWebOAuthRedirect(corsOrigin, success) ??
      buildMobileOAuthRedirect(success)
    );
  }

  private peekOAuthState(state: string | undefined): OAuthStatePayload | null {
    if (!state) return null;
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
      throw new BadRequestException('Invalid or expired OAuth state');
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
      throw new BadRequestException('Google did not return a refresh token');
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

    const sender = this.resolveSenderFields({
      bankSenderEmail: payload.bankSenderEmail,
      bankDomain: payload.bankDomain,
    });
    await this.upsertInstitutionSource(payload.sub, {
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
      throw new NotFoundException('Email source tokens not found');
    }

    const expiresSoon =
      !source.connection.tokenExpiresAt ||
      source.connection.tokenExpiresAt.getTime() - Date.now() < 5 * 60 * 1000;

    if (expiresSoon) {
      return this.refreshGmailToken(sourceId);
    }

    return decryptToken(source.connection.accessToken, this.encryptionKey);
  }

  async listPendingAssignment(userId: string) {
    const rows = await this.repo.listPendingAssignmentMessages(userId);
    return rows.map((row) => this.mapPendingMessage(row));
  }

  async listRecentMessages(userId: string) {
    const rows = await this.repo.listRecentEmailMessages(userId);
    return rows.map((row) => ({
      ...this.mapPendingMessage(row),
      outcome: row.outcome,
    }));
  }

  async assignPendingMessage(
    userId: string,
    messageId: string,
    dto: AssignEmailMessageDto,
  ) {
    await this.users.assertFinanceEmailSyncEnabled(userId);
    const message = await this.repo.findEmailMessageById(userId, messageId);
    if (!message) {
      throw new NotFoundException('Email message not found');
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
      throw new BadRequestException('Email message is not pending assignment');
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
      throw new NotFoundException('Email message not found');
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
      throw new BadRequestException('Email message is not pending assignment');
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
      throw new NotFoundException('Email message not found');
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
      throw new BadRequestException('amount must be positive');
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
      throw new NotFoundException('Email source not found');
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
        if (!email || known.has(email)) continue;
        if (extractEmailDomain(email) !== source.bankDomain) continue;
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
      throw new NotFoundException('Email source not found');
    }
    const sender = this.resolveSenderFields({
      bankSenderEmails: [...(source.bankSenderEmails ?? []), ...emails],
      bankDomain: source.bankDomain,
    });
    const updated = await this.repo.updateEmailSource(userId, sourceId, {
      bankSenderEmails: sender.bankSenderEmails,
      bankDomain: sender.bankDomain,
    });
    if (!updated) {
      throw new NotFoundException('Email source not found');
    }
    return this.mapEmailSourceResponse(updated);
  }

  private async importPendingMessage(
    userId: string,
    message: PendingMessageRow,
    target: { accountId?: string; cardId?: string; amount?: number },
  ) {
    const extracted = parseExtractedPayload(message.extractedPayload);
    if (!extracted) {
      throw new BadRequestException('Email message has no extract to assign');
    }
    const amount = target.amount ?? extracted.amount;
    if (amount == null) {
      throw new BadRequestException('Email message is missing an amount');
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
        throw new BadRequestException('Account is not active');
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
        throw new BadRequestException('Card is not active');
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
      throw new NotFoundException('Email source tokens not found');
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

  private async upsertInstitutionSource(
    userId: string,
    input: {
      connectionId: string;
      institutionId: string;
      bankSenderEmails: string[];
      bankDomain: string;
      label?: string;
    },
  ) {
    const existing = await this.repo.findSourceByUserAndInstitution(
      userId,
      input.institutionId,
    );
    if (existing?.isActive && existing.connectionId !== input.connectionId) {
      throw new ConflictException(
        'This institution is already linked to a mailbox',
      );
    }
    if (existing) {
      const updated = await this.repo.updateEmailSource(userId, existing.id, {
        connectionId: input.connectionId,
        bankSenderEmails: input.bankSenderEmails,
        bankDomain: input.bankDomain,
        ...(input.label !== undefined ? { label: input.label } : {}),
        isActive: true,
      });
      const mapped = this.mapEmailSourceResponse(updated ?? existing);
      if (await this.users.isFinanceEmailSyncAutomatic(userId)) {
        await this.enqueueGmailSyncJob(userId, mapped.id, { dedupe: true });
      }
      return mapped;
    }

    const created = await this.repo.createEmailSource(userId, {
      connectionId: input.connectionId,
      institutionId: input.institutionId,
      bankSenderEmails: input.bankSenderEmails,
      bankDomain: input.bankDomain,
      label: input.label,
      isActive: true,
    });
    const mapped = this.mapEmailSourceResponse(created);
    if (await this.users.isFinanceEmailSyncAutomatic(userId)) {
      await this.enqueueGmailSyncJob(userId, mapped.id, { dedupe: true });
    }
    return mapped;
  }

  private async enqueueGmailSyncJob(
    userId: string,
    sourceId: string,
    options: { forceFullSync?: boolean; dedupe?: boolean } = {},
  ): Promise<{ queued: true } | { queued: false; reason: string }> {
    const forceFullSync = options.forceFullSync === true;
    if (!this.gmailSyncQueue) {
      return {
        queued: false,
        reason:
          'gmail-sync queue is unavailable. Verify REDIS_ENABLED=true and REDIS_URL, then restart the API.',
      };
    }

    try {
      await this.gmailSyncQueue.add(
        GMAIL_SYNC_JOB_NAME,
        { userId, sourceId, forceFullSync },
        {
          ...GMAIL_SYNC_JOB_OPTIONS,
          ...(options.dedupe && !forceFullSync
            ? { jobId: gmailSyncJobId(sourceId) }
            : {}),
        },
      );
      return { queued: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(
        `Failed to enqueue Gmail sync for ${sourceId}: ${message}`,
      );
      return {
        queued: false,
        reason: `Could not enqueue gmail-sync: ${message}`,
      };
    }
  }

  private resolveSenderFields(input: {
    bankSenderEmail?: string;
    bankSenderEmails?: string[];
    bankDomain?: string;
  }): { bankSenderEmails: string[]; bankDomain: string } {
    const senders = normalizeBankSenderEmails({
      bankSenderEmail: input.bankSenderEmail,
      bankSenderEmails: input.bankSenderEmails,
    });
    if (senders.length === 0) {
      const domain = input.bankDomain?.trim();
      if (!domain) {
        throw new BadRequestException(
          'bankSenderEmail or bankDomain is required',
        );
      }
      return { bankSenderEmails: [], bankDomain: domain };
    }
    const domain = extractEmailDomain(senders[0]);
    const mismatched = senders.filter(
      (email) => extractEmailDomain(email) !== domain,
    );
    if (mismatched.length > 0) {
      throw new BadRequestException(
        'All sender emails must share the same domain',
      );
    }
    return { bankSenderEmails: senders, bankDomain: domain };
  }

  private get encryptionKey(): string {
    return this.config.get('ENCRYPTION_KEY', { infer: true });
  }

  private get oauthStateSecret(): string {
    const secret = this.config.get('OAUTH_STATE_SECRET', { infer: true });
    if (secret) return secret;

    const nodeEnv = this.config.get('NODE_ENV', { infer: true });
    if (nodeEnv === 'production') {
      throw new Error('OAUTH_STATE_SECRET is required in production');
    }

    this.logger.warn(
      'OAUTH_STATE_SECRET is not set; falling back to ENCRYPTION_KEY (non-production only)',
    );
    return this.encryptionKey;
  }

  private mapEmailSourceResponse(source: EmailSourceRow) {
    return {
      id: source.id,
      connectionId: source.connectionId,
      institutionId: source.institutionId,
      institutionName: source.institution?.name ?? null,
      emailAddress: source.connection.emailAddress,
      bankSenderEmail: source.bankSenderEmails?.[0] ?? null,
      bankSenderEmails: source.bankSenderEmails ?? [],
      bankDomain: source.bankDomain,
      label: source.label,
      provider: source.connection.provider,
      isActive: source.isActive,
      lastSyncedAt: source.lastSyncedAt?.toISOString() ?? null,
      createdAt: source.createdAt.toISOString(),
      logs: (source.logs ?? []).map((log) => ({
        id: log.id,
        status: log.status,
        error: log.error,
        emailsScanned: log.emailsScanned,
        transactionsNew: log.transactionsNew,
        startedAt: log.startedAt.toISOString(),
        completedAt: log.completedAt?.toISOString() ?? null,
      })),
    };
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
