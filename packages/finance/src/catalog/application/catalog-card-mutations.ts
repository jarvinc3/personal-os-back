import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@personal-os/database';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { CatalogCardRepository } from '../infrastructure/catalog-card.repository';
import type { CreateCardDto } from '../presentation/dto/create-card.dto';
import type { UpdateCardDto } from '../presentation/dto/update-card.dto';

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

@Injectable()
export class CatalogCardMutations {
  constructor(
    private readonly repo: CatalogCardRepository,
    private readonly ownership: FinanceOwnershipService,
  ) {}

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

    return this.repo.createCard(userId, {
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
    return updated;
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
