import { Injectable, NotFoundException } from '@nestjs/common';
import {
  clampPageLimit,
  decodeCursor,
  toCursorPage,
  type CursorQueryDto,
} from '@personal-os/core';
import { decimalToString } from '../../shared/domain/mappers';
import { INSTRUMENT_EVENT_KIND } from '../../shared/domain/instrument-event';
import { CatalogRepository } from '../infrastructure/catalog.repository';

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
  constructor(private readonly repo: CatalogRepository) {}

  async getAccountHistory(
    userId: string,
    accountId: string,
    query: CursorQueryDto,
  ) {
    const account = await this.repo.findAccountById(accountId, userId);
    if (!account) {
      throw new NotFoundException('Account not found');
    }
    return this.buildHistory(userId, { accountId }, query);
  }

  async getCardHistory(userId: string, cardId: string, query: CursorQueryDto) {
    const card = await this.repo.findCardById(userId, cardId);
    if (!card) {
      throw new NotFoundException('Card not found');
    }
    return this.buildHistory(userId, { cardId }, query);
  }

  private async buildHistory(
    userId: string,
    target: InstrumentTarget,
    query: CursorQueryDto,
  ) {
    const [events, adjustments] = await Promise.all([
      this.repo.findInstrumentEvents(userId, target),
      this.repo.findAdjustmentTransactions(userId, target),
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

    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const afterCursor = cursor
      ? items.filter(
          (item) =>
            item.at < cursor.key ||
            (item.at === cursor.key && item.id < cursor.id),
        )
      : items;

    return toCursorPage(
      afterCursor,
      clampPageLimit(query.limit),
      (item) => item.at,
    );
  }
}
