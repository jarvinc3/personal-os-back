import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@personal-os/database';
import { clampPageLimit, toCursorPage } from '@personal-os/core';
import type { CursorQueryDto } from '@personal-os/core';
import { PurgeInstrumentLedgerUseCase } from '../../ledger/application/purge-instrument-ledger.use-case';
import { assertRestored } from '../../shared/application/assert-restored';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { CatalogCardRepository } from '../infrastructure/catalog-card.repository';
import type { CreateCardDto } from '../presentation/dto/create-card.dto';
import type { UpdateCardDto } from '../presentation/dto/update-card.dto';
import { CatalogViews } from './catalog-views';

type CardDetailRow = NonNullable<
  Awaited<ReturnType<CatalogCardRepository['findCardById']>>
>;

type CardRelocationInput = {
  userId: string;
  nextType: string;
  nextInstitutionId: string;
  dto: UpdateCardDto;
  existing: CardDetailRow;
};

/** Cards: their lifecycle, their link to an account and their public shape. */
@Injectable()
export class CatalogCardsService {
  constructor(
    private readonly repo: CatalogCardRepository,
    private readonly ownership: FinanceOwnershipService,
    private readonly purgeLedger: PurgeInstrumentLedgerUseCase,
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

  async createCard(userId: string, dto: CreateCardDto) {
    if (!dto.lastFour) {
      throw new BadRequestException('lastFour es obligatorio');
    }
    await this.ownership.assertInstitutionAcceptsBankProducts(
      userId,
      dto.institutionId,
    );
    if (dto.type === 'DEBIT') {
      if (!dto.accountId) {
        throw new BadRequestException('Las tarjetas DEBIT requieren accountId');
      }
      await this.ownership.assertDebitAccountAlignment({
        userId,
        accountId: dto.accountId,
        institutionId: dto.institutionId,
      });
    }
    if (dto.type === 'CREDIT' && dto.accountId) {
      throw new BadRequestException(
        'Las tarjetas CREDIT no deben llevar accountId',
      );
    }

    const created = await this.repo.createCard(userId, {
      institutionId: dto.institutionId,
      accountId: dto.type === 'DEBIT' ? dto.accountId : null,
      name: dto.name,
      type: dto.type,
      network: dto.network,
      lastFour: dto.lastFour,
      statementClosingDay: dto.statementClosingDay,
      paymentDueDay: dto.paymentDueDay,
      color: dto.color,
    });
    return this.views.card(created, await this.views.localToday(userId));
  }

  async updateCard(userId: string, id: string, dto: UpdateCardDto) {
    const existing = await this.repo.findCardById(userId, id);
    if (!existing) {
      throw new NotFoundException('Tarjeta no encontrada');
    }

    const nextType = dto.type ?? existing.type;
    const nextInstitutionId = dto.institutionId ?? existing.institutionId;
    if (!dto.lastFour && !existing.lastFour) {
      throw new BadRequestException('lastFour es obligatorio');
    }
    if (dto.institutionId) {
      await this.ownership.assertInstitutionAcceptsBankProducts(
        userId,
        dto.institutionId,
      );
    }
    await this.assertCardRelocation({
      userId,
      nextType,
      nextInstitutionId,
      dto,
      existing,
    });
    if (nextType === 'CREDIT' && dto.accountId) {
      throw new BadRequestException(
        'Las tarjetas CREDIT no deben llevar accountId',
      );
    }

    const updated = await this.repo.updateCard(
      userId,
      id,
      this.buildCardUpdate(dto, nextType),
    );
    if (!updated) {
      throw new NotFoundException('Tarjeta no encontrada');
    }
    return this.views.card(updated, await this.views.localToday(userId));
  }

  async deactivateCard(userId: string, id: string) {
    const updated = await this.repo.updateCard(userId, id, { isActive: false });
    if (!updated) {
      throw new NotFoundException('Tarjeta no encontrada');
    }
    return { success: true };
  }

  async deleteCard(userId: string, id: string) {
    const existing = await this.repo.findCardById(userId, id);
    if (!existing) {
      throw new NotFoundException('Tarjeta no encontrada');
    }
    const purged = await this.purgeLedger.forCard(userId, id);
    const removed = await this.repo.deleteCard({
      userId,
      id,
      movements: purged.rows,
    });
    if (removed.count === 0) {
      throw new NotFoundException('Tarjeta no encontrada');
    }
    return { success: true };
  }

  async restoreCard(userId: string, id: string, now: Date) {
    const restored = await this.repo.restoreCard(userId, id, now);
    assertRestored(restored, 'Card not found');
    return { success: true };
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

  private async assertCardRelocation({
    userId,
    nextType,
    nextInstitutionId,
    dto,
    existing,
  }: CardRelocationInput): Promise<void> {
    const relocatingDebit =
      nextType === 'DEBIT' &&
      (dto.type !== undefined ||
        dto.accountId !== undefined ||
        dto.institutionId !== undefined);
    if (!relocatingDebit) {
      return;
    }
    const nextAccountId =
      dto.accountId !== undefined ? dto.accountId : existing.accountId;
    if (!nextAccountId) {
      throw new BadRequestException('Las tarjetas DEBIT requieren accountId');
    }
    await this.ownership.assertDebitAccountAlignment({
      userId,
      accountId: nextAccountId,
      institutionId: nextInstitutionId,
    });
  }

  private buildCardUpdate(
    dto: UpdateCardDto,
    nextType: string,
  ): Prisma.FinCardUpdateInput {
    return {
      ...(dto.institutionId ? { institutionId: dto.institutionId } : {}),
      ...(dto.name ? { name: dto.name } : {}),
      ...(dto.type ? { type: dto.type } : {}),
      ...(dto.network !== undefined ? { network: dto.network } : {}),
      ...(dto.lastFour !== undefined ? { lastFour: dto.lastFour } : {}),
      ...(dto.statementClosingDay !== undefined
        ? { statementClosingDay: dto.statementClosingDay }
        : {}),
      ...(dto.paymentDueDay !== undefined
        ? { paymentDueDay: dto.paymentDueDay }
        : {}),
      ...(dto.color !== undefined ? { color: dto.color } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      ...this.resolveCardAccountId(dto, nextType),
    };
  }

  private resolveCardAccountId(
    dto: UpdateCardDto,
    nextType: string,
  ): { accountId?: string | null } {
    if (nextType === 'CREDIT') {
      return { accountId: null };
    }
    if (dto.accountId === undefined) {
      return {};
    }
    return { accountId: dto.accountId };
  }
}
