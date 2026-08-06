import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Job } from 'bullmq';
import { TransactionCreatedEvent } from '../../core/events/domain-events';
import { AppEvents } from '../../core/events/event.constants';
import { GmailSyncJob } from '../../core/queues/queue-jobs';
import { QueueNames } from '../../core/queues/queue.constants';
import { EmailParserRegistry } from './email-parsers/email-parser.registry';
import { FinanceRepository } from './finance.repository';
import { FinanceService } from './finance.service';
import { getGmailMessage, listGmailMessages, parseGmailMessage } from './utils/gmail-api.util';

@Injectable()
@Processor(QueueNames.GMAIL_SYNC)
export class GmailSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(GmailSyncProcessor.name);

  constructor(
    private readonly financeRepo: FinanceRepository,
    private readonly financeService: FinanceService,
    private readonly emailParserRegistry: EmailParserRegistry,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super();
  }

  async process(job: Job<GmailSyncJob>): Promise<void> {
    const { userId, sourceId, forceFullSync } = job.data;
    const source = await this.financeRepo.findEmailSource(userId, sourceId);
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

    const syncLog = await this.financeRepo.createEmailSyncLog(sourceId);
    let emailsScanned = 0;
    let transactionsNew = 0;

    try {
      this.logger.log(`Starting Gmail sync for source ${sourceId}`);
      const accessToken = await this.financeService.getValidGmailAccessToken(sourceId);

      const afterUnix = forceFullSync
        ? undefined
        : source.lastSyncedAt
          ? Math.floor(source.lastSyncedAt.getTime() / 1000)
          : undefined;

      let query = `from:${source.bankDomain}`;
      if (afterUnix) {
        query += ` after:${afterUnix}`;
      }

      let pageToken: string | undefined;
      let lastMessageId = source.lastMessageId ?? undefined;

      do {
        const listResult = await listGmailMessages(accessToken, query, pageToken);
        for (const messageRef of listResult.messages) {
          emailsScanned += 1;
          lastMessageId = messageRef.id;

          const existing = await this.financeRepo.findTransactionByEmailMessageId(messageRef.id);
          if (existing) {
            continue;
          }

          try {
            const message = await getGmailMessage(accessToken, messageRef.id);
            const { from, subject, body } = parseGmailMessage(message);
            const parsed = this.emailParserRegistry.parse(from, subject, body);
            if (!parsed) {
              this.logger.debug(`No parser match for message ${messageRef.id}`);
              continue;
            }

            const created = await this.financeRepo.createEmailPendingTransaction(userId, {
              accountId: source.accountId ?? undefined,
              cardId: source.cardId ?? undefined,
              emailMessageId: messageRef.id,
              amount: parsed.amount,
              currency: parsed.currency,
              merchant: parsed.merchant,
              description: parsed.description,
              transactionDate: new Date(parsed.transactionDate),
              type: parsed.type,
            });

            transactionsNew += 1;
            this.eventEmitter.emit(
              AppEvents.TRANSACTION_CREATED,
              new TransactionCreatedEvent(
                userId,
                created.id,
                Number(created.amount),
              ),
            );
          } catch (error) {
            if (error instanceof Error && error.message.includes('Unique constraint')) {
              continue;
            }
            throw error;
          }
        }
        pageToken = listResult.nextPageToken;
      } while (pageToken);

      await this.financeRepo.updateEmailSource(userId, sourceId, {
        lastSyncedAt: new Date(),
        ...(lastMessageId ? { lastMessageId } : {}),
      });

      await this.financeRepo.completeEmailSyncLog(syncLog.id, {
        status: 'SUCCESS',
        emailsScanned,
        transactionsNew,
      });

      this.logger.log(
        `Gmail sync completed for ${sourceId}: ${emailsScanned} scanned, ${transactionsNew} new`,
      );
    } catch (error) {
      await this.financeRepo.completeEmailSyncLog(syncLog.id, {
        status: 'FAILED',
        emailsScanned,
        transactionsNew,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<GmailSyncJob>, error: Error) {
    this.logger.error(`Gmail sync job ${job.id ?? 'unknown'} failed: ${error.message}`);
  }
}
