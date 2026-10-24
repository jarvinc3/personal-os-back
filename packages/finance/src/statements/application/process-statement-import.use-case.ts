import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { STATEMENT_IMPORT_ERROR } from '../domain/statement-import-errors';
import { resolveStatementCategoryId } from '../domain/statement-category';
import {
  matchStatementLines,
  type StatementLineType,
} from '../domain/statement-line-matching';
import {
  readParsedStatement,
  type StatementImportParsed,
} from '../domain/statement-import-view';
import {
  STATEMENT_EXTRACTOR,
  type ExtractedStatement,
  type StatementExtractorPort,
} from './ports/statement-extractor.port';
import {
  STATEMENT_PDF_TEXT,
  StatementPasswordError,
  type StatementPdfTextPort,
} from './ports/statement-pdf.port';
import {
  StatementImportsRepository,
  type StatementImportCategory,
  type StatementImportContext,
  type StatementImportLineDraft,
} from '../infrastructure/statement-imports.repository';

type ParsedLine = {
  id: string;
  date: Date;
  description: string;
  amount: number;
  currency: string;
  type: StatementLineType;
  reference: string | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseDay(value: string): Date | null {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function endOfDay(value: string): Date | null {
  const parsed = new Date(`${value.slice(0, 10)}T23:59:59.999Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

@Injectable()
export class ProcessStatementImportUseCase {
  private readonly logger = new Logger(ProcessStatementImportUseCase.name);

  constructor(
    private readonly repo: StatementImportsRepository,
    @Inject(STATEMENT_PDF_TEXT)
    private readonly pdfText: StatementPdfTextPort,
    @Inject(STATEMENT_EXTRACTOR)
    private readonly extractor: StatementExtractorPort,
  ) {}

  async execute(input: {
    userId: string;
    importId: string;
    bytes: Uint8Array;
    password?: string;
  }): Promise<void> {
    const context = await this.repo.findImportContext(
      input.userId,
      input.importId,
    );
    if (!context) {
      return;
    }
    try {
      const text = await this.pdfText.extractText({
        bytes: input.bytes,
        password: input.password,
      });
      if (text.trim().length === 0) {
        await this.fail(
          context.id,
          'The PDF has no extractable text',
          STATEMENT_IMPORT_ERROR.PARSE_FAILED,
        );
        return;
      }
      const categories = await this.repo.listCategories(input.userId);
      const extraction = await this.extractor.extract({
        userId: input.userId,
        sourceId: context.id,
        text,
        categories: categories.map((category) => ({
          name: category.name,
          type: category.type,
        })),
        knownCurrency: this.knownCurrency(context),
      });
      if (!extraction.ok) {
        await this.fail(
          context.id,
          extraction.reason,
          STATEMENT_IMPORT_ERROR.PARSE_FAILED,
        );
        return;
      }
      await this.persistParsed(context, extraction.statement, categories);
    } catch (error) {
      if (error instanceof StatementPasswordError) {
        await this.fail(
          context.id,
          error.message,
          STATEMENT_IMPORT_ERROR.PASSWORD_REQUIRED,
        );
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Statement import ${context.id} failed: ${message}`);
      await this.fail(context.id, message, STATEMENT_IMPORT_ERROR.PARSE_FAILED);
    }
  }

  private knownCurrency(context: StatementImportContext): string | undefined {
    return (
      context.account?.currency ??
      context.card?.balances[0]?.currency ??
      undefined
    );
  }

  private async persistParsed(
    context: StatementImportContext,
    statement: ExtractedStatement,
    categories: readonly StatementImportCategory[],
  ): Promise<void> {
    const parsedLines = statement.lines
      .map((line) => {
        const date = parseDay(line.date);
        if (!date) {
          this.logger.warn(`Skipping statement row with date "${line.date}"`);
          return null;
        }
        return {
          id: randomUUID(),
          date,
          description: line.description,
          amount: line.amount,
          currency: line.currency,
          type: line.type,
          reference: line.reference,
          categoryId: resolveStatementCategoryId({
            categories,
            hint: line.categoryNameHint,
            type: line.type,
          }),
        };
      })
      .filter((line): line is NonNullable<typeof line> => line !== null);

    const period = this.resolvePeriod(statement, parsedLines);
    const movements = period
      ? await this.repo.findMovementsForMatching({
          userId: context.userId,
          cardId: context.cardId,
          accountId: context.accountId,
          from: period.from,
          to: period.to,
        })
      : [];

    const match = matchStatementLines({
      lines: parsedLines.map((line) => ({
        id: line.id,
        date: line.date,
        description: line.description,
        amount: line.amount,
        currency: line.currency,
        type: line.type,
        reference: line.reference,
      })),
      movements,
    });
    const matchedByLine = new Map(
      match.matches.map((entry) => [entry.lineId, entry.transactionId]),
    );
    const lineDrafts: StatementImportLineDraft[] = parsedLines.map((line) => ({
      date: line.date,
      description: line.description,
      amount: line.amount,
      currency: line.currency,
      type: line.type,
      reference: line.reference,
      categoryId: line.categoryId,
      transactionId: matchedByLine.get(line.id) ?? null,
      decision: matchedByLine.has(line.id) ? 'MATCH' : 'CREATE',
    }));
    await this.repo.replaceLines(context.id, lineDrafts);

    const extraIds = new Set(match.extraTransactionIds);
    const parsed: StatementImportParsed = {
      header: {
        ...statement.header,
        currency: statement.header.currency,
      },
      period: period
        ? { from: period.from.toISOString(), to: period.to.toISOString() }
        : null,
      counts: {
        lines: lineDrafts.length,
        matched: match.matches.length,
        missing: match.missingLineIds.length,
        extra: extraIds.size,
      },
      extra: movements
        .filter((movement) => extraIds.has(movement.id))
        .map((movement) => ({
          id: movement.id,
          date: movement.transactionDate.toISOString(),
          description: movement.description,
          merchant: movement.merchant,
          amount: movement.amount,
          currency: movement.currency,
          type: movement.type,
        })),
    };
    await this.repo.updateResult({
      importId: context.id,
      status: 'READY',
      parsed,
      error: null,
    });
  }

  private resolvePeriod(
    statement: ExtractedStatement,
    parsedLines: readonly ParsedLine[],
  ): { from: Date; to: Date } | null {
    const from =
      (statement.header.periodStart
        ? parseDay(statement.header.periodStart)
        : null) ?? this.earliestLineDate(parsedLines);
    const to =
      (statement.header.periodEnd
        ? endOfDay(statement.header.periodEnd)
        : null) ?? this.latestLineDate(parsedLines);
    if (!from || !to) {
      return null;
    }
    return { from, to };
  }

  private earliestLineDate(parsedLines: readonly ParsedLine[]): Date | null {
    if (parsedLines.length === 0) {
      return null;
    }
    const earliest = Math.min(
      ...parsedLines.map((line) => line.date.getTime()),
    );
    return new Date(earliest);
  }

  private latestLineDate(parsedLines: readonly ParsedLine[]): Date | null {
    if (parsedLines.length === 0) {
      return null;
    }
    const latest = Math.max(...parsedLines.map((line) => line.date.getTime()));
    return new Date(latest + MS_PER_DAY - 1);
  }

  private async fail(
    importId: string,
    reason: string,
    code: string,
  ): Promise<void> {
    const parsed = readParsedStatement({});
    parsed.failureReason = reason;
    await this.repo.updateResult({
      importId,
      status: 'FAILED',
      parsed,
      error: code,
    });
  }
}
