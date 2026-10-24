import { Injectable, Logger } from '@nestjs/common';
import { ImportEmailTransactionUseCase } from '../../ledger/application/import-email-transaction.use-case';
import { EMAIL_MESSAGE_OUTCOME } from './email-message-outcome';
import { isAtmMovementClass } from './email-movement';
import {
  isUnpairedTransferCandidate,
  movementClassOf,
  pickTransferMatch,
  uniqueCashAccountId,
} from './match-email-transfers';
import { parseExtractedPayload } from './parse-extracted-email';
import { FinancialImportCandidatesPort } from './ports/financial-import-candidates.port';
import { RouteExtractedEmailUseCase } from './route-extracted-email.use-case';

const TRANSFER_MATCH_LOOKBACK_DAYS = 365;

@Injectable()
export class BackfillPendingEmailUseCase {
  private readonly logger = new Logger(BackfillPendingEmailUseCase.name);

  constructor(
    private readonly emailSources: FinancialImportCandidatesPort,
    private readonly routeExtracted: RouteExtractedEmailUseCase,
    private readonly importEmail: ImportEmailTransactionUseCase,
  ) {}

  async execute(userId: string): Promise<{ imported: number }> {
    const pending =
      await this.emailSources.listPendingAssignmentCandidates(userId);
    let imported = 0;
    for (const message of pending) {
      if (message.outcome === EMAIL_MESSAGE_OUTCOME.PENDING_AMOUNT) {
        continue;
      }
      const extracted = parseExtractedPayload(message.extractedPayload);
      if (!extracted) {
        continue;
      }
      try {
        const [accounts, cards] =
          await this.emailSources.listInstitutionDestinations(
            userId,
            message.source.institutionId,
          );
        const result = await this.routeExtracted.execute({
          userId,
          sourceId: message.sourceId,
          sourceReference: message.sourceReference,
          extracted,
          provider: message.provider,
          model: message.model,
          accounts,
          cards,
          cashAccounts: [],
        });
        if (result.kind === 'imported') {
          imported += 1;
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(
          `Backfill: message ${message.sourceReference} failed; skipping for this run: ${reason}`,
        );
      }
    }
    return { imported };
  }
}

@Injectable()
export class MatchEmailTransfersUseCase {
  constructor(
    private readonly emailSources: FinancialImportCandidatesPort,
    private readonly importEmail: ImportEmailTransactionUseCase,
  ) {}

  async execute(
    userId: string,
  ): Promise<{ paired: number; atmCompleted: number }> {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - TRANSFER_MATCH_LOOKBACK_DAYS);
    const rows = await this.emailSources.listMovementsForTransferMatch(
      userId,
      since,
    );
    const cashAccountId = uniqueCashAccountId(
      await this.emailSources.listCashAccounts(userId),
    );
    let atmCompleted = 0;
    if (cashAccountId) {
      for (const row of rows) {
        const extracted = parseExtractedPayload(
          row.emailMessage?.extractedPayload,
        );
        const movement = movementClassOf(row);
        const unpaired =
          !row.transferGroupId ||
          rows.filter((item) => item.transferGroupId === row.transferGroupId)
            .length === 1;
        if (
          row.type !== 'DEBIT' ||
          !unpaired ||
          !isAtmMovementClass(movement) ||
          extracted?.amount == null
        ) {
          continue;
        }
        await this.importEmail.completeAtmFromExpense(
          userId,
          row.id,
          cashAccountId,
          {
            amount: extracted.amount,
            currency: row.currency,
            transactionDate: row.transactionDate,
            description: row.description,
            notes: row.notes,
            status: 'CONFIRMED',
          },
        );
        atmCompleted += 1;
      }
    }

    const refreshed = await this.emailSources.listMovementsForTransferMatch(
      userId,
      since,
    );
    const unpaired = refreshed.filter((row) =>
      isUnpairedTransferCandidate(row, refreshed),
    );
    const used = new Set<string>();
    let paired = 0;
    for (const row of unpaired) {
      if (used.has(row.id)) {
        continue;
      }
      if (
        isAtmMovementClass(
          parseExtractedPayload(row.emailMessage?.extractedPayload)
            ?.movementClass,
        )
      ) {
        continue;
      }
      const match = pickTransferMatch(
        row,
        unpaired.filter((item) => !used.has(item.id)),
      );
      if (!match) {
        continue;
      }
      const debitId = row.type === 'DEBIT' ? row.id : match.id;
      const creditId = row.type === 'CREDIT' ? row.id : match.id;
      await this.importEmail.pairTransferLegs(userId, debitId, creditId);
      used.add(row.id);
      used.add(match.id);
      paired += 1;
    }
    return { paired, atmCompleted };
  }
}
