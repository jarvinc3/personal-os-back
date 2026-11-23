import { Injectable } from '@nestjs/common';
import type { CursorQueryDto } from '@personal-os/core';
import type { CreateCardDto } from '../presentation/dto/create-card.dto';
import type { UpdateCardDto } from '../presentation/dto/update-card.dto';
import { CatalogCardLifecycle } from './catalog-card-lifecycle';
import { CatalogCardMutations } from './catalog-card-mutations';
import { CatalogCardReads } from './catalog-card-reads';

/** Cards: reads, writes and lifecycle with the same public surface. */
@Injectable()
export class CatalogCardsService {
  constructor(
    private readonly reads: CatalogCardReads,
    private readonly mutations: CatalogCardMutations,
    private readonly lifecycle: CatalogCardLifecycle,
  ) {}

  listCardsPage(userId: string, query: CursorQueryDto) {
    return this.reads.listCardsPage(userId, query);
  }

  listCards(userId: string) {
    return this.reads.listCards(userId);
  }

  getCard(userId: string, id: string) {
    return this.reads.getCard(userId, id);
  }

  async createCard(userId: string, dto: CreateCardDto) {
    return this.reads.presentCard(
      userId,
      await this.mutations.createCard(userId, dto),
    );
  }

  async updateCard(userId: string, id: string, dto: UpdateCardDto) {
    return this.reads.presentCard(
      userId,
      await this.mutations.updateCard(userId, id, dto),
    );
  }

  deactivateCard(userId: string, id: string) {
    return this.lifecycle.deactivateCard(userId, id);
  }

  deleteCard(userId: string, id: string) {
    return this.lifecycle.deleteCard(userId, id);
  }

  restoreCard(userId: string, id: string, now: Date) {
    return this.lifecycle.restoreCard(userId, id, now);
  }

  lookupCards(userId: string, ids: readonly string[]) {
    return this.reads.lookupCards(userId, ids);
  }
}
