import { Inject, Injectable, Logger } from '@nestjs/common';
import { ImportEmailTransactionUseCase } from '../../ledger/application/import-email-transaction.use-case';
import { LedgerQueryService } from '../../ledger/application/ledger-query.service';
import { ReverseTransactionUseCase } from '../../ledger/application/reverse-transaction.use-case';
import { EMAIL_TRANSACTION_EXTRACTOR } from '../../shared/application/tokens';
import { mapBankStatusToInternal } from '../../shared/domain/transaction-status';
import { EmailSourceRepository } from '../infrastructure/email-source.repository';
import {
    getGmailMessage,
    listGmailMessages,
    parseGmailMessage,
} from '../infrastructure/gmail-api.util';
import { IngestionService } from './ingestion.service';
import type { EmailTransactionExtractorPort } from './ports/email-transaction-extractor.port';

@Injectable()
export class ProcessGmailSyncUseCase {
  private readonly logger = new Logger(ProcessGmailSyncUseCase.name);

  constructor(
    private readonly emailSources: EmailSourceRepository,
    private readonly ingestion: IngestionService,
    private readonly importEmail: ImportEmailTransactionUseCase,
    private readonly reverseTx: ReverseTransactionUseCase,
    private readonly ledger: LedgerQueryService,
    @Inject(EMAIL_TRANSACTION_EXTRACTOR)
    private readonly extractor: EmailTransactionExtractorPort,
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

    if (!source.accountId && !source.cardId) {
      this.logger.warn(
        `Gmail sync source ${sourceId} has no linked account or card — skipping`,
      );
      return;
    }

    const syncLog = await this.emailSources.createEmailSyncLog(sourceId);
    let emailsScanned = 0;
    let transactionsNew = 0;
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

      let query = `from:${source.bankDomain}`;
      if (afterUnix) query += ` after:${afterUnix}`;

      let pageToken: string | undefined;
      let lastMessageId = source.lastMessageId ?? undefined;
      const categories = await this.emailSources.listCategories(userId);

      do {
        const listResult = await listGmailMessages(
          accessToken,
          query,
          pageToken,
        );
        for (const messageRef of listResult.messages) {
          emailsScanned += 1;
          lastMessageId = messageRef.id;

          const existing = await this.ledger.findTransactionByEmailMessageId(
            messageRef.id,
          );
          if (existing) continue;

          try {
            const message = await getGmailMessage(accessToken, messageRef.id);
            const { from, subject, body } = parseGmailMessage(message);
            const extraction = await this.extractor.extract({
              from,
              subject,
              body,
              bankDomain: source.bankDomain,
            });
            if (!extraction.ok) {
              this.logger.debug(
                `No AI extract for message ${messageRef.id}: ${extraction.reason}`,
              );
              continue;
            }

            const extracted = extraction.data;
            const status = mapBankStatusToInternal({
              bankStatusNormalized: extracted.bankStatusNormalized,
              statusConfidence: extracted.statusConfidence,
            });

            if (status === 'REVERSED') {
              const original = await this.findOriginalForReverse(
                userId,
                extracted.reverseOfEmailMessageId,
                extracted.merchant,
                extracted.amount,
                extracted.currency,
                new Date(extracted.transactionDate),
              );
              if (original) {
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
                transactionsNew += 1;
                countsByStatus.REVERSED = (countsByStatus.REVERSED ?? 0) + 1;
                transactionIds.push(original.id);
              }
              continue;
            }

            const categoryId =
              categories.find(
                (c) =>
                  extracted.categoryNameHint &&
                  c.name.toLowerCase() ===
                    extracted.categoryNameHint.toLowerCase(),
              )?.id ?? null;

            const created = await this.importEmail.execute(userId, {
              accountId: source.accountId ?? undefined,
              cardId: source.cardId ?? undefined,
              emailMessageId: messageRef.id,
              amount: extracted.amount,
              currency: extracted.currency,
              merchant: extracted.merchant,
              description: extracted.description,
              transactionDate: new Date(extracted.transactionDate),
              type: extracted.type,
              status,
              categoryId,
              aiMetadata: {
                bankStatusRaw: extracted.bankStatusRaw,
                bankStatusNormalized: extracted.bankStatusNormalized,
                statusEvidence: extracted.statusEvidence,
                statusConfidence: extracted.statusConfidence,
                provider: extraction.provider,
                model: extraction.model,
                extractedAt: new Date().toISOString(),
              },
            });

            transactionsNew += 1;
            countsByStatus[status] = (countsByStatus[status] ?? 0) + 1;
            transactionIds.push(created.id);
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
        pageToken = listResult.nextPageToken;
      } while (pageToken);

      await this.emailSources.updateEmailSource(userId, sourceId, {
        lastSyncedAt: new Date(),
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
        `Gmail sync completed for ${sourceId}: ${emailsScanned} scanned, ${transactionsNew} new`,
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

  private async findOriginalForReverse(
    userId: string,
    reverseEmailMessageId: string | null,
    merchant: string | null,
    amount: number,
    currency: string,
    aroundDate: Date,
  ) {
    if (reverseEmailMessageId) {
      const byEmail =
        await this.ledger.findTransactionByEmailMessageId(reverseEmailMessageId);
      if (byEmail && byEmail.userId === userId) return byEmail;
    }
    const candidates = await this.ledger.findReverseCandidates(userId, {
      amount,
      currency,
      merchant,
      aroundDate,
    });
    return candidates[0] ?? null;
  }
}
