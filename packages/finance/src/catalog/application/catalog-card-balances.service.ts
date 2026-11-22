import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  decimalToNullableString,
  decimalToString,
} from '../../shared/domain/mappers';
import { CatalogRepository } from '../infrastructure/catalog.repository';
import type { UpdateCardBalanceDto } from '../presentation/dto/update-card-balance.dto';

type CardBalanceRow = NonNullable<
  Awaited<ReturnType<CatalogRepository['upsertCardBalance']>>
>;

/** Balances of a credit card: one row per currency plus its limit. */
@Injectable()
export class CatalogCardBalancesService {
  constructor(private readonly repo: CatalogRepository) {}

  async updateCardBalance(
    userId: string,
    id: string,
    dto: UpdateCardBalanceDto,
  ) {
    const card = await this.findCard(userId, id);
    if (card.type === 'DEBIT') {
      throw new BadRequestException(
        'DEBIT cards use their linked account balance',
      );
    }
    if (card.type === 'CREDIT' && dto.creditLimit === undefined) {
      throw new BadRequestException(
        'Las tarjetas CREDIT requieren creditLimit',
      );
    }
    const updated = await this.repo.upsertCardBalance(
      userId,
      id,
      dto.currency.toUpperCase(),
      dto.balance,
      dto.creditLimit,
    );
    if (!updated) {
      throw new NotFoundException('Tarjeta no encontrada');
    }
    return this.toBalanceResponse(updated);
  }

  async updateCardCreditLimit(
    userId: string,
    id: string,
    dto: { currency: string; creditLimit: number },
  ) {
    const card = await this.findCard(userId, id);
    if (card.type !== 'CREDIT') {
      throw new BadRequestException(
        'Solo las tarjetas de crédito tienen límite',
      );
    }
    const updated = await this.repo.setCardCreditLimit(
      userId,
      id,
      dto.currency,
      dto.creditLimit,
    );
    if (!updated) {
      throw new NotFoundException('Tarjeta no encontrada');
    }
    return this.toBalanceResponse(updated);
  }

  async deleteCardBalance(userId: string, id: string, currency: string) {
    const card = await this.findCard(userId, id);
    if (card.type === 'DEBIT') {
      throw new BadRequestException(
        'DEBIT cards use their linked account balance',
      );
    }
    const deletion = await this.repo.deleteCardBalance(userId, id, currency);
    if (deletion.count === 0) {
      throw new NotFoundException('Saldo de tarjeta no encontrado');
    }
    return { success: true };
  }

  private async findCard(userId: string, id: string) {
    const card = await this.repo.findCardById(userId, id);
    if (!card) {
      throw new NotFoundException('Tarjeta no encontrada');
    }
    return card;
  }

  private toBalanceResponse(balance: CardBalanceRow) {
    return {
      id: balance.id,
      cardId: balance.cardId,
      currency: balance.currency,
      balance: decimalToString(balance.balance),
      creditLimit: decimalToNullableString(balance.creditLimit),
    };
  }
}
