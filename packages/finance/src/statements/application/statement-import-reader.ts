import { Injectable, NotFoundException } from '@nestjs/common';
import { roundMoney } from '../../shared/domain/money';
import {
  readParsedStatement,
  type StatementImportParsed,
} from '../domain/statement-import-view';
import {
  StatementImportsRepository,
  type StatementImportContext,
} from '../infrastructure/statement-imports.repository';
import {
  mapStatementImport,
  type StatementImportView,
} from './statement-import-mappers';
import { STATEMENT_IMPORT_NOT_FOUND_MESSAGE } from './statement-import.constants';

/** Reads an import, its lines and the balance difference it would cover. */
@Injectable()
export class StatementImportReader {
  constructor(private readonly repo: StatementImportsRepository) {}

  async view(userId: string, importId: string): Promise<StatementImportView> {
    return this.toView(await this.context(userId, importId));
  }

  async context(
    userId: string,
    importId: string,
  ): Promise<StatementImportContext> {
    const context = await this.repo.findImportContext(userId, importId);
    if (!context) {
      throw new NotFoundException(STATEMENT_IMPORT_NOT_FOUND_MESSAGE);
    }
    return context;
  }

  private async toView(
    context: StatementImportContext,
  ): Promise<StatementImportView> {
    const parsed = readParsedStatement(context.parsed);
    const categories = await this.repo.listCategories(context.userId);
    const difference = await this.computeDifference(context, parsed);
    return mapStatementImport({ context, parsed, difference, categories });
  }

  private async computeDifference(
    context: StatementImportContext,
    parsed: StatementImportParsed,
  ): Promise<number | null> {
    const closing = parsed.header.closingBalance;
    if (closing === null) {
      return null;
    }
    const target = await this.repo.findTargetBalance({
      userId: context.userId,
      cardId: context.cardId,
      accountId: context.accountId,
      currency: parsed.header.currency,
    });
    if (!target) {
      return null;
    }
    const current =
      target.creditLimit === null
        ? target.currentBalance
        : target.creditLimit - target.currentBalance;
    return roundMoney(closing - current);
  }
}
