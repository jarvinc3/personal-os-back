import { Injectable, NotFoundException } from '@nestjs/common';
import {
  clampPageLimit,
  decodeCursor,
  toCursorPage,
  type CursorQueryDto,
} from '@personal-os/core';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { debtAtClosing } from '../domain/card-statement-amounts';
import {
  buildClosedCardCycles,
  firstDueDateAfter,
  isStatementDay,
  startOfUtcDay,
} from '../domain/card-statement-cycle';
import {
  buildCardStatementViews,
  type CardStatementSnapshot,
} from '../domain/card-statement-views';
import { CardStatementsRepository } from '../infrastructure/card-statements.repository';
import { mapCardStatement } from './card-statement-mappers';

type StatementRow = {
  id: string;
  currency: string;
  cycleStart: Date;
  cycleEnd: Date;
  dueDate: Date | null;
  closingBalance: { toString(): string } | number | string;
  minimumPayment: { toString(): string } | number | string | null | undefined;
  minimumSource: string | null | undefined;
};

function toSnapshot(row: StatementRow): CardStatementSnapshot {
  return {
    id: row.id,
    currency: row.currency,
    cycleStart: row.cycleStart,
    cycleEnd: row.cycleEnd,
    dueDate: row.dueDate,
    closingBalance: Number(row.closingBalance),
    minimumPayment:
      row.minimumPayment == null ? null : Number(row.minimumPayment),
    minimumSource:
      row.minimumSource == null
        ? null
        : (row.minimumSource as CardStatementSnapshot['minimumSource']),
  };
}

@Injectable()
export class CardStatementsService {
  constructor(
    private readonly repo: CardStatementsRepository,
    private readonly ownership: FinanceOwnershipService,
  ) {}

  async listCardStatements(
    userId: string,
    cardId: string,
    query: CursorQueryDto,
    now: Date,
  ) {
    await this.ownership.assertCardOwned(userId, cardId);
    const limit = clampPageLimit(query.limit);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const card = await this.repo.findCreditCard(cardId);
    if (!card) {
      throw new NotFoundException('Credit card not found');
    }

    const rows = await this.repo.listStatements(cardId, {
      cursor,
      take: limit + 1,
    });
    const views = buildCardStatementViews({
      statements: rows.map(toSnapshot),
      movements: card.transactions,
      today: startOfUtcDay(now),
    });
    return toCursorPage(views.map(mapCardStatement), limit, (statement) =>
      statement.cycleEnd.toISOString(),
    );
  }

  async getStatementDetail(
    userId: string,
    cardId: string,
    statementId: string,
    now: Date,
  ) {
    await this.ownership.assertCardOwned(userId, cardId);
    const card = await this.repo.findCreditCard(cardId);
    if (!card) {
      throw new NotFoundException('Credit card not found');
    }
    const row = await this.repo.findStatement(cardId, statementId);
    if (!row) {
      throw new NotFoundException('Statement not found');
    }
    const [view] = buildCardStatementViews({
      statements: [toSnapshot(row)],
      movements: card.transactions,
      today: startOfUtcDay(now),
    });
    const insideCycle = (date: Date) =>
      date.getTime() >= row.cycleStart.getTime() &&
      date.getTime() <= row.cycleEnd.getTime();
    const paymentWindowEnd =
      row.dueDate && row.dueDate.getTime() < now.getTime() ? row.dueDate : now;
    return {
      statement: mapCardStatement(view),
      movements: card.transactions.filter(
        (movement) =>
          movement.ledgerCurrency === row.currency &&
          movement.type !== 'CARD_PAYMENT' &&
          movement.type !== 'ADJUSTMENT' &&
          insideCycle(movement.transactionDate),
      ),
      payments: card.transactions.filter(
        (movement) =>
          movement.ledgerCurrency === row.currency &&
          movement.type === 'CARD_PAYMENT' &&
          movement.status === 'CONFIRMED' &&
          movement.transactionDate.getTime() > row.cycleEnd.getTime() &&
          movement.transactionDate.getTime() <= paymentWindowEnd.getTime(),
      ),
    };
  }

  async updateStatement(
    userId: string,
    cardId: string,
    statementId: string,
    dto: {
      minimumPayment?: number;
      closingBalance?: number;
      dueDate?: string;
    },
  ): Promise<void> {
    await this.ownership.assertCardOwned(userId, cardId);
    const row = await this.repo.findStatement(cardId, statementId);
    if (!row) {
      throw new NotFoundException('Statement not found');
    }
    await this.repo.updateStatement(statementId, {
      minimumPayment: dto.minimumPayment,
      closingBalance: dto.closingBalance,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
    });
  }

  /**
   * Materializes the closing snapshot of every cycle already closed. Running it
   * again is safe: cycles are keyed by closing date and upserted.
   */
  async syncCardStatements(cardId: string, now: Date): Promise<void> {
    const card = await this.repo.findCreditCard(cardId);
    if (!card) {
      return;
    }
    const userId = await this.repo.findCardOwnerId(cardId);
    const closingDay = card.statementClosingDay;
    if (!isStatementDay(closingDay)) {
      return;
    }
    const dueDay = isStatementDay(card.paymentDueDay)
      ? card.paymentDueDay
      : null;
    const today = startOfUtcDay(now);

    for (const balance of card.balances) {
      const creditLimit = balance.creditLimit;
      if (creditLimit === null) {
        continue;
      }
      const movements = card.transactions.filter(
        (movement) => movement.ledgerCurrency === balance.currency,
      );
      const firstMovement = movements[0];
      if (!firstMovement) {
        continue;
      }
      const cycles = buildClosedCardCycles({
        closingDay,
        firstActivityDate: firstMovement.transactionDate,
        today,
      });
      for (const cycle of cycles) {
        const dueDate =
          dueDay === null ? null : firstDueDateAfter(cycle.cycleEnd, dueDay);
        const closingBalance = debtAtClosing({
          currentAvailable: Number(balance.balance),
          creditLimit: Number(creditLimit),
          movements,
          closingDate: cycle.cycleEnd,
          today,
        });
        const [view] = buildCardStatementViews({
          statements: [
            {
              id: '',
              currency: balance.currency,
              cycleStart: cycle.cycleStart,
              cycleEnd: cycle.cycleEnd,
              dueDate,
              closingBalance,
              minimumPayment: null,
              minimumSource: null,
            },
          ],
          movements,
          today,
        });
        const statementId = await this.repo.upsertStatement({
          cardId,
          currency: balance.currency,
          cycleStart: cycle.cycleStart,
          cycleEnd: cycle.cycleEnd,
          dueDate,
          closingBalance,
          minimumPayment: view.minimumPayment,
          minimumSource: view.minimumSource,
          status: view.status,
        });
        if (view.status !== 'OPEN' && userId) {
          await this.repo.recordStatementClosedEvent({
            userId,
            cardId,
            statementId,
            currency: balance.currency,
            cycleEnd: cycle.cycleEnd,
            closingBalance,
          });
        }
      }
    }
  }

  async syncAllCreditCards(now: Date): Promise<void> {
    const cards = await this.repo.listCreditCardsToSync();
    for (const card of cards) {
      await this.syncCardStatements(card.id, now);
    }
  }
}
