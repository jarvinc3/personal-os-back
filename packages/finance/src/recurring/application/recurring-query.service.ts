import { Injectable } from '@nestjs/common';
import { clampPageLimit, decodeCursor, toCursorPage } from '@personal-os/core';
import { upcomingPatterns } from '../domain/recurring-alerts';
import { RecurringRepository } from '../infrastructure/recurring.repository';
import type {
  ListRecurringQueryDto,
  UpcomingRecurringQueryDto,
} from '../presentation/dto/list-recurring-query.dto';
import { mapPattern } from './recurring-mappers';

/** Reads the recurring patterns of a user: the page and the upcoming charges. */
@Injectable()
export class RecurringQueryService {
  constructor(private readonly repo: RecurringRepository) {}

  async list(userId: string, query: ListRecurringQueryDto, now = new Date()) {
    const limit = clampPageLimit(query.limit);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await this.repo.listPatterns(userId, {
      cursor,
      take: limit + 1,
      status: query.status,
    });
    const page = toCursorPage(rows, limit, (row) =>
      row.nextExpectedDate.toISOString(),
    );
    return {
      ...page,
      items: page.items.map((row) => mapPattern(row, now)),
    };
  }

  async upcoming(
    userId: string,
    query: UpcomingRecurringQueryDto,
    now = new Date(),
  ) {
    const patterns = await this.repo.findConfirmedPatterns(userId);
    return upcomingPatterns(patterns, { today: now, days: query.days }).map(
      (entry) => ({
        ...mapPattern(entry.pattern, now),
        daysUntil: entry.daysUntil,
      }),
    );
  }
}
