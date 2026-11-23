import { Injectable } from '@nestjs/common';
import { UsersService } from '@personal-os/users';
import { resolveCardDueDaysBefore } from '../../settings/finance-settings';
import { isoDay, localDayStart } from '../../shared/domain/local-day';
import {
  buildCardStatementViews,
  type CardStatementSnapshot,
} from '../domain/card-statement-views';
import type { StatementMovement } from '../domain/card-statement-amounts';
import { CardStatementsRepository } from '../infrastructure/card-statements.repository';
import { CardPaymentReminderOutbox } from './card-payment-reminder-outbox';

const FINANCE_MODULE_SLUG = 'finance';
const MS_PER_DAY = 86_400_000;

type DueStatement = Awaited<
  ReturnType<CardStatementsRepository['listDueStatements']>
>[number];

function toSnapshot(statement: DueStatement): CardStatementSnapshot {
  return {
    id: statement.id,
    currency: statement.currency,
    cycleStart: statement.cycleStart,
    cycleEnd: statement.cycleEnd,
    dueDate: statement.dueDate,
    closingBalance: Number(statement.closingBalance),
    minimumPayment:
      statement.minimumPayment === null
        ? null
        : Number(statement.minimumPayment),
    minimumSource: statement.minimumSource,
  };
}

/**
 * Payment reminders for closed statements. A statement is reminded once per due
 * date and never when it is already paid; the outbox event id makes it
 * idempotent across runs.
 */
@Injectable()
export class CardPaymentRemindersService {
  constructor(
    private readonly repo: CardStatementsRepository,
    private readonly users: UsersService,
    private readonly outbox: CardPaymentReminderOutbox,
  ) {}

  async evaluate(userId: string, now = new Date()): Promise<void> {
    const profile = await this.users.findById(userId);
    const today = localDayStart(profile?.timezone ?? null, now);
    const windowDays = resolveCardDueDaysBefore(
      profile?.userModules.find((module) => module.slug === FINANCE_MODULE_SLUG)
        ?.config,
    );
    const dueStatements = await this.repo.listDueStatements({
      userId,
      from: today,
      to: new Date(today.getTime() + windowDays * MS_PER_DAY),
    });
    for (const statement of dueStatements) {
      await this.remindStatement(userId, statement, today);
    }
    this.outbox.wake();
  }

  private async remindStatement(
    userId: string,
    statement: DueStatement,
    today: Date,
  ): Promise<void> {
    const dueDate = statement.dueDate;
    if (!dueDate) {
      return;
    }
    const card = await this.repo.findCreditCard(statement.cardId);
    if (!card) {
      return;
    }
    const movements: readonly StatementMovement[] = card.transactions.filter(
      (movement) => movement.ledgerCurrency === statement.currency,
    );
    const [view] = buildCardStatementViews({
      statements: [toSnapshot(statement)],
      movements,
      today,
    });
    if (view.status === 'PAID' || view.closingBalance <= 0) {
      return;
    }
    const eventId = `finance-card-payment-due:${statement.id}:${isoDay(dueDate)}`;
    if (await this.outbox.hasEvent(eventId)) {
      return;
    }
    await this.outbox.publish({
      eventId,
      statementId: statement.id,
      userId,
      payload: {
        cardId: statement.cardId,
        statementId: statement.id,
        cardName: statement.card.name,
        currency: statement.currency,
        closingBalance: view.closingBalance,
        remaining: view.remaining,
        minimumPayment: view.minimumPayment,
        dueDate: isoDay(dueDate),
        daysUntil: Math.round(
          (dueDate.getTime() - today.getTime()) / MS_PER_DAY,
        ),
      },
    });
  }
}
