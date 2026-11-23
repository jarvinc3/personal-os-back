import { Injectable } from '@nestjs/common';
import type { StatementImportParsed } from '../domain/statement-import-view';
import { CardStatementsRepository } from '../infrastructure/card-statements.repository';
import type { StatementImportContext } from '../infrastructure/statement-imports.repository';

/** Card statement closed by an applied import. */
@Injectable()
export class StatementImportStatementSync {
  constructor(private readonly cardStatements: CardStatementsRepository) {}

  async sync(
    context: StatementImportContext,
    parsed: StatementImportParsed,
  ): Promise<string | null> {
    if (!context.cardId || !parsed.period) {
      return null;
    }
    const cycleEnd = new Date(parsed.period.to);
    const closingBalance = parsed.header.closingBalance ?? 0;
    const statementId = await this.cardStatements.upsertStatement({
      cardId: context.cardId,
      currency: parsed.header.currency,
      cycleStart: new Date(parsed.period.from),
      cycleEnd,
      dueDate: parsed.header.dueDate ? new Date(parsed.header.dueDate) : null,
      closingBalance,
      minimumPayment: parsed.header.minimumPayment ?? 0,
      minimumSource: parsed.header.minimumPayment === null ? null : 'IMPORTED',
      status: 'CLOSED',
    });
    await this.cardStatements.recordStatementClosedEvent({
      userId: context.userId,
      cardId: context.cardId,
      statementId,
      currency: parsed.header.currency,
      cycleEnd,
      closingBalance,
    });
    return statementId;
  }
}
