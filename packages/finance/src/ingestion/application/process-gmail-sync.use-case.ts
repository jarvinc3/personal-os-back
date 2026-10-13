import { Inject, Injectable, Logger } from '@nestjs/common';
import { resolveMaxEmailLlmExtracts } from '@personal-os/config';
import { LedgerQueryService } from '../../ledger/application/ledger-query.service';
import { ReverseTransactionUseCase } from '../../ledger/application/reverse-transaction.use-case';
import { EMAIL_TRANSACTION_EXTRACTOR } from '../../shared/application/tokens';
import { mapBankStatusToInternal } from '../../shared/domain/transaction-status';
import { emailFingerprint } from '../../shared/domain/email-fingerprint';
import { EmailSourceRepository } from '../infrastructure/email-source.repository';
import {
  getGmailMessage,
  listGmailMessages,
  parseGmailMessage,
} from '../infrastructure/gmail-api.util';
import {
  BackfillPendingEmailUseCase,
  MatchEmailTransfersUseCase,
} from './backfill-pending-email.use-case';
import { buildGmailFromQuery } from './bank-sender';
import {
  shouldReopenSkippedPayroll,
  isCardPaymentReminder,
} from './email-movement';
import { EMAIL_MESSAGE_OUTCOME } from './email-message-outcome';
import { IngestionService } from './ingestion.service';
import type {
  EmailTransactionExtractorPort,
  ExtractedEmailTransaction,
} from './ports/email-transaction-extractor.port';
import { RouteExtractedEmailUseCase } from './route-extracted-email.use-case';
import { RetryPendingReversesUseCase } from './retry-pending-reverses.use-case';
import { findReverseOriginal } from './resolve-reverse-original';

@Injectable()
export class ProcessGmailSyncUseCase {
  private readonly logger = new Logger(ProcessGmailSyncUseCase.name);

  constructor(
    private readonly emailSources: EmailSourceRepository,
    private readonly ingestion: IngestionService,
    private readonly reverseTx: ReverseTransactionUseCase,
    private readonly ledger: LedgerQueryService,
    @Inject(EMAIL_TRANSACTION_EXTRACTOR)
    private readonly extractor: EmailTransactionExtractorPort,
    private readonly routeExtracted: RouteExtractedEmailUseCase,
    private readonly backfillPending: BackfillPendingEmailUseCase,
    private readonly matchTransfers: MatchEmailTransfersUseCase,
    private readonly retryPendingReverses: RetryPendingReversesUseCase,
  ) {}

  async execute(params: {
    userId: string;
    sourceId: string;
    forceFullSync?: boolean;
  }): Promise<void> {
    const { userId, sourceId, forceFullSync } = params;
    const source = await this.emailSources.findEmailSource(userId, sourceId);
    if (!source || !source.isActive) {
      this.logger.warn(`Gmail sync source not found or inactive: ${sourceId}`);
      return;
    }

    const syncLog = await this.emailSources.createEmailSyncLog(sourceId);
    let emailsScanned = 0;
    let transactionsNew = 0;
    let emailsSkipped = 0;
    let llmExtracts = 0;
    const maxLlmExtracts = resolveMaxEmailLlmExtracts();
    const transactionIds: string[] = [];
    const countsByStatus: Record<string, number> = {};

    try {
      this.logger.log(`Starting Gmail sync for source ${sourceId}`);
      const accessToken =
        await this.ingestion.getValidGmailAccessToken(sourceId);

      const afterUnix = forceFullSync
        ? undefined
        : source.lastSyncedAt
          ? Math.floor(source.lastSyncedAt.getTime() / 1000)
          : undefined;

      let query = buildGmailFromQuery(source);
      if (afterUnix) {
        query += ` after:${afterUnix}`;
      }

      let pageToken: string | undefined;
      let lastMessageId = source.lastMessageId ?? undefined;
      const categories = await this.emailSources.listCategories(userId);
      const categoryHints = categories.map((c) => ({
        name: c.name,
        type: c.type,
      }));
      const [accounts, cards] =
        await this.emailSources.listInstitutionDestinations(
          userId,
          source.institutionId,
        );
      const cashAccounts = await this.emailSources.listCashAccounts(userId);
      let hitLlmCap = false;
      let deferredRetryable = false;

      do {
        const listResult = await listGmailMessages(
          accessToken,
          query,
          pageToken,
        );
        for (const messageRef of listResult.messages) {
          emailsScanned += 1;
          lastMessageId = messageRef.id;

          const seenMessage = await this.emailSources.findEmailMessage(
            sourceId,
            messageRef.id,
          );
          const reopenSkipped =
            Boolean(seenMessage) &&
            shouldReopenSkippedPayroll({
              outcome: seenMessage!.outcome,
              reason: seenMessage!.reason,
            });
          if (seenMessage && !reopenSkipped) {
            emailsSkipped += 1;
            continue;
          }

          if (llmExtracts >= maxLlmExtracts) {
            hitLlmCap = true;
            this.logger.warn(
              `Gmail sync ${sourceId}: LLM extract cap ${maxLlmExtracts} reached; remaining messages deferred to next sync`,
            );
            break;
          }

          try {
            const message = await getGmailMessage(accessToken, messageRef.id);
            const { from, subject, body, internalDate } =
              parseGmailMessage(message);
            const fingerprint = emailFingerprint({ from, subject, body });
            const seenByFingerprint =
              await this.emailSources.findEmailMessageByFingerprint(
                sourceId,
                fingerprint,
              );
            if (seenByFingerprint) {
              await this.emailSources.upsertEmailMessage({
                sourceId,
                gmailMessageId: messageRef.id,
                outcome: EMAIL_MESSAGE_OUTCOME.SKIPPED_DUPLICATE,
                reason: `Same email content as ${seenByFingerprint.id}`,
                fingerprint,
              });
              emailsSkipped += 1;
              continue;
            }
            llmExtracts += 1;
            const extraction = await this.extractor.extract({
              from,
              subject,
              body,
              bankDomain: source.bankDomain,
              categories: categoryHints,
              ...(internalDate
                ? { receivedAt: internalDate.toISOString() }
                : {}),
            });

            if (!extraction.ok) {
              this.logger.debug(
                `No AI extract for message ${messageRef.id}: ${extraction.reason}`,
              );
              if (!extraction.retryable) {
                await this.emailSources.upsertEmailMessage({
                  sourceId,
                  gmailMessageId: messageRef.id,
                  outcome: EMAIL_MESSAGE_OUTCOME.FAILED_NON_RETRYABLE,
                  reason: extraction.reason,
                });
                emailsSkipped += 1;
              } else {
                deferredRetryable = true;
              }
              continue;
            }

            if (extraction.kind === 'not_transaction') {
              if (isCardPaymentReminder({ subject, body })) {
                await this.ingestion.enqueueCardStatementReminder(userId, {
                  sourceId,
                  gmailMessageId: messageRef.id,
                  subject,
                });
              }
              await this.emailSources.upsertEmailMessage({
                sourceId,
                gmailMessageId: messageRef.id,
                outcome: EMAIL_MESSAGE_OUTCOME.SKIPPED_NOT_TX,
                reason: extraction.reason,
                provider: extraction.provider,
                model: extraction.model,
              });
              emailsSkipped += 1;
              continue;
            }

            const extracted: ExtractedEmailTransaction = {
              ...extraction.data,
              transactionDate:
                extraction.data.transactionDate ||
                (internalDate ?? new Date()).toISOString(),
            };
            try {
              const status = mapBankStatusToInternal({
                bankStatusNormalized: extracted.bankStatusNormalized,
                statusConfidence: extracted.statusConfidence,
              });

              if (status === 'REVERSED' && extraction.kind === 'transaction') {
                const original = await findReverseOriginal(
                  this.ledger,
                  userId,
                  {
                    reverseEmailMessageId: extracted.reverseOfEmailMessageId,
                    reverseOriginalRef: extracted.reverseOriginalRef,
                    merchant: extracted.merchant,
                    amount: extracted.amount ?? 0,
                    currency: extracted.currency,
                    aroundDate: new Date(extracted.transactionDate),
                  },
                );
                if (original?.status === 'REVERSED') {
                  await this.emailSources.upsertEmailMessage({
                    sourceId,
                    gmailMessageId: messageRef.id,
                    outcome: EMAIL_MESSAGE_OUTCOME.SKIPPED_DUPLICATE,
                    reason: `Reversal already applied to transaction ${original.id}`,
                    provider: extraction.provider,
                    model: extraction.model,
                    extractedPayload: extracted,
                  });
                  emailsSkipped += 1;
                  continue;
                }
                if (!original) {
                  await this.emailSources.upsertEmailMessage({
                    sourceId,
                    gmailMessageId: messageRef.id,
                    outcome: EMAIL_MESSAGE_OUTCOME.PENDING_REVERSE,
                    reason: 'No matching original transaction yet',
                    provider: extraction.provider,
                    model: extraction.model,
                    instrumentHint: extracted.instrumentHint,
                    lastFourHint: extracted.lastFourHint,
                    accountNumberHint: extracted.accountNumberHint,
                    extractedPayload: extracted,
                  });
                  emailsSkipped += 1;
                  continue;
                }
                await this.reverseTx.execute(userId, original.id, {
                  bankStatusRaw: extracted.bankStatusRaw,
                  bankStatusNormalized: extracted.bankStatusNormalized,
                  statusEvidence: extracted.statusEvidence,
                  statusConfidence: extracted.statusConfidence,
                  reverseEmailMessageId: messageRef.id,
                  provider: extraction.provider,
                  model: extraction.model,
                  extractedAt: new Date().toISOString(),
                });
                await this.emailSources.upsertEmailMessage({
                  sourceId,
                  gmailMessageId: messageRef.id,
                  outcome: EMAIL_MESSAGE_OUTCOME.IMPORTED,
                  provider: extraction.provider,
                  model: extraction.model,
                  instrumentHint: extracted.instrumentHint,
                  lastFourHint: extracted.lastFourHint,
                  accountNumberHint: extracted.accountNumberHint,
                  extractedPayload: extracted,
                });
                transactionsNew += 1;
                countsByStatus.REVERSED = (countsByStatus.REVERSED ?? 0) + 1;
                transactionIds.push(original.id);
                continue;
              }

              const routed = await this.routeExtracted.execute({
                userId,
                sourceId,
                gmailMessageId: messageRef.id,
                extracted,
                provider: extraction.provider,
                model: extraction.model,
                accounts,
                cards,
                cashAccounts,
              });

              if (routed.kind === 'imported') {
                transactionsNew += 1;
                countsByStatus[routed.status] =
                  (countsByStatus[routed.status] ?? 0) + 1;
                transactionIds.push(routed.transactionId);
              } else {
                emailsSkipped += 1;
              }
            } catch (error) {
              if (
                error instanceof Error &&
                error.message.includes('Unique constraint')
              ) {
                continue;
              }
              const reason =
                error instanceof Error ? error.message : 'Unknown error';
              this.logger.warn(
                `Gmail sync ${sourceId}: message ${messageRef.id} failed to import; recording and continuing: ${reason}`,
              );
              await this.emailSources.upsertEmailMessage({
                sourceId,
                gmailMessageId: messageRef.id,
                outcome: EMAIL_MESSAGE_OUTCOME.FAILED_NON_RETRYABLE,
                reason,
                provider: extraction.provider,
                model: extraction.model,
                extractedPayload: extracted,
              });
              emailsSkipped += 1;
            }
          } catch (error) {
            if (
              error instanceof Error &&
              error.message.includes('Unique constraint')
            ) {
              continue;
            }
            throw error;
          }
        }
        if (hitLlmCap) {
          break;
        }
        pageToken = listResult.nextPageToken;
      } while (pageToken);

      const backfill = await this.backfillPending.execute(userId);
      transactionsNew += backfill.imported;
      const reversalActions =
        await this.retryPendingReverses.listActions(userId);
      for (const action of reversalActions) {
        await this.retryPendingReverses.applyAction(userId, action);
        if (action.kind !== 'apply') {
          continue;
        }
        transactionsNew += 1;
        countsByStatus.REVERSED = (countsByStatus.REVERSED ?? 0) + 1;
        transactionIds.push(action.originalId);
      }
      await this.matchTransfers.execute(userId);

      const deferredWork = hitLlmCap || deferredRetryable;
      await this.emailSources.updateEmailSource(userId, sourceId, {
        ...(deferredWork ? {} : { lastSyncedAt: new Date() }),
        ...(lastMessageId ? { lastMessageId } : {}),
      });

      await this.ingestion.completeEmailSyncSuccessWithEvent({
        logId: syncLog.id,
        userId,
        sourceId,
        emailsScanned,
        transactionsNew,
        transactionIds,
        countsByStatus,
      });

      this.logger.log(
        `Gmail sync completed for ${sourceId}: ${emailsScanned} scanned, ${transactionsNew} new, ${emailsSkipped} skipped, ${llmExtracts} LLM extracts`,
      );
    } catch (error) {
      await this.emailSources.completeEmailSyncLog(syncLog.id, {
        status: 'FAILED',
        emailsScanned,
        transactionsNew,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }
}

export type { ExtractedEmailTransaction };
