import { Injectable, NotFoundException } from '@nestjs/common';
import { clampPageLimit, toCursorPage } from '@personal-os/core';
import type { CursorQueryDto } from '@personal-os/core';
import { CatalogCardRepository } from '../infrastructure/catalog-card.repository';
import { CatalogViews } from './catalog-views';

/** Cards read with their public shape: page, list, detail and batch. */
@Injectable()
export class CatalogCardReads {
  constructor(
    private readonly repo: CatalogCardRepository,
    private readonly views: CatalogViews,
  ) {}

  async listCardsPage(userId: string, query: CursorQueryDto) {
    const rows = await this.repo.listCardsPage(userId, query);
    const page = toCursorPage(rows, clampPageLimit(query.limit), (row) =>
      row.createdAt.toISOString(),
    );
    const today = await this.views.localToday(userId);
    return {
      ...page,
      items: page.items.map((card) => this.views.card(card, today)),
    };
  }

  async listCards(userId: string) {
    const cards = await this.repo.listCards(userId);
    const today = await this.views.localToday(userId);
    return cards.map((card) => this.views.card(card, today));
  }

  async getCard(userId: string, id: string) {
    const card = await this.repo.findCardById(userId, id);
    if (!card) {
      throw new NotFoundException('Tarjeta no encontrada');
    }
    return this.views.card(card, await this.views.localToday(userId));
  }

  /** Public card shape for the writes, without reading it again. */
  async presentCard(
    userId: string,
    row: NonNullable<
      Awaited<ReturnType<CatalogCardRepository['findCardById']>>
    >,
  ) {
    return this.views.card(row, await this.views.localToday(userId));
  }

  /** Same public shape as the card detail, loaded in batch and without throwing. */
  async lookupCards(userId: string, ids: readonly string[]) {
    const rows = await this.repo.findCardsByIds(userId, ids);
    if (rows.length === 0) {
      return new Map<string, ReturnType<CatalogViews['card']>>();
    }
    const today = await this.views.localToday(userId);
    return new Map(rows.map((row) => [row.id, this.views.card(row, today)]));
  }
}
