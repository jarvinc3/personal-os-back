import { Injectable, NotFoundException } from '@nestjs/common';
import {
  clampPageLimit,
  decodeCursor,
  toCursorPage,
  type CursorQueryDto,
} from '@personal-os/core';
import { decimalToString } from '../../shared/domain/mappers';
import { INSTRUMENT_EVENT_KIND } from '../../shared/domain/instrument-event';
import { CatalogAccountRepository } from '../infrastructure/catalog-account.repository';
import { CatalogCardRepository } from '../infrastructure/catalog-card.repository';
import { CatalogInstrumentHistoryRepository } from '../infrastructure/catalog-instrument-history.repository';

type InstrumentTarget = { accountId?: string; cardId?: string };

export type InstrumentHistoryItem = {
  id: string;
  kind: string;
  at: string;
  amount: string | null;
  currency: string | null;
  payload: Record<string, unknown>;
};

function asPayload(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

@Injectable()
export class InstrumentHistoryService {
  constructor(
    private readonly accounts: CatalogAccountRepository,
    private readonly cards: CatalogCardRepository,
    private readonly history: CatalogInstrumentHistoryRepository,
  ) {}

  async getAccountHistory(
    userId: string,
    accountId: string,
    query: CursorQueryDto,
  ) {
    const account = await this.accounts.findAccountById(accountId, userId);
    if (!account) {
      throw new NotFoundException('Cuenta no encontrada');
    }
    return this.buildHistory(userId, { accountId }, query);
  }

  async getCardHistory(userId: string, cardId: string, query: CursorQueryDto) {
    const card = await this.cards.findCardById(userId, cardId);
    if (!card) {
      throw new NotFoundException('Tarjeta no encontrada');
    }
    return this.buildHistory(userId, { cardId }, query);
  }

  private async buildHistory(
    userId: string,
    target: InstrumentTarget,
    query: CursorQueryDto,
  ) {
    const limit = clampPageLimit(query.limit);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const take = limit + 1;
    const [events, adjustments] = await Promise.all([
      this.history.findInstrumentEvents(userId, target, { cursor, take }),
      this.history.findAdjustmentTransactions(userId, target, { cursor, take }),
    ]);

    const items: InstrumentHistoryItem[] = [
      ...events.map((event) => ({
        id: event.id,
        kind: event.kind,
        at: event.createdAt.toISOString(),
        amount: null,
        currency: null,
        payload: asPayload(event.payload),
      })),
      ...adjustments.map((transaction) => ({
        id: transaction.id,
        kind: INSTRUMENT_EVENT_KIND.ADJUSTMENT,
        at: transaction.transactionDate.toISOString(),
        amount: decimalToString(transaction.amount),
        currency: transaction.currency,
        payload: { transactionId: transaction.id },
      })),
    ].sort((left, right) =>
      left.at === right.at
        ? right.id.localeCompare(left.id)
        : right.at.localeCompare(left.at),
    );

    const afterCursor = cursor
      ? items.filter(
          (item) =>
            item.at < cursor.key ||
            (item.at === cursor.key && item.id < cursor.id),
        )
      : items;

    return toCursorPage(afterCursor, limit, (item) => item.at);
  }
}
