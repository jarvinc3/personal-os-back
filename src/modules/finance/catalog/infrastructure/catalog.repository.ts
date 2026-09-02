import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../../prisma/generated/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { normalizeCurrencyCode } from '../../shared/presentation/validation.decorators';
import type { CreateAccountDto } from '../presentation/dto/create-account.dto';
import type { UpdateAccountDto } from '../presentation/dto/update-account.dto';

@Injectable()
export class CatalogRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAccountsByUser(userId: string) {
    return this.prisma.finAccount.findMany({
      where: { userId, isActive: true },
      orderBy: { name: 'asc' },
      include: { institutionRef: true },
    });
  }

  findAccountById(id: string, userId: string) {
    return this.prisma.finAccount.findFirst({
      where: { id, userId },
      include: { institutionRef: true },
    });
  }

  createAccount(userId: string, dto: CreateAccountDto) {
    const data: Prisma.FinAccountUncheckedCreateInput = {
      userId,
      name: dto.name,
      type: dto.type,
      currency: dto.currency ?? 'DOP',
      balance: 0,
      institutionId: dto.institutionId,
    };
    if (dto.color) data.color = dto.color;

    return this.prisma.finAccount.create({
      data,
      include: { institutionRef: true },
    });
  }

  updateAccount(id: string, userId: string, dto: UpdateAccountDto) {
    return this.prisma.finAccount
      .updateMany({
        where: { id, userId },
        data: {
          institutionId: dto.institutionId,
          name: dto.name,
          type: dto.type,
          currency: dto.currency,
          color: dto.color,
          isActive: dto.isActive,
        },
      })
      .then(async (result) => {
        if (result.count === 0) return null;
        return this.findAccountById(id, userId);
      });
  }

  listInstitutions(userId: string) {
    return this.prisma.finInstitution.findMany({
      where: { userId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  createInstitution(
    userId: string,
    data: Omit<Prisma.FinInstitutionUncheckedCreateInput, 'userId'>,
  ) {
    return this.prisma.finInstitution.create({ data: { ...data, userId } });
  }

  updateInstitution(
    userId: string,
    id: string,
    data: Prisma.FinInstitutionUpdateInput,
  ) {
    return this.prisma.finInstitution
      .updateMany({ where: { userId, id }, data })
      .then(async (result) => {
        if (result.count === 0) return null;
        return this.prisma.finInstitution.findFirst({ where: { userId, id } });
      });
  }

  listCards(userId: string) {
    return this.prisma.finCard.findMany({
      where: { userId, isActive: true },
      include: {
        institution: true,
        account: { select: { id: true, name: true } },
        balances: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findCardById(userId: string, id: string) {
    return this.prisma.finCard.findFirst({
      where: { id, userId },
      include: {
        institution: true,
        account: { select: { id: true, name: true } },
        balances: true,
      },
    });
  }

  createCard(
    userId: string,
    data: Omit<Prisma.FinCardUncheckedCreateInput, 'userId'>,
  ) {
    const payload = { ...data };
    if (payload.type === 'CREDIT') payload.accountId = null;
    if (typeof payload.lastFour === 'string') {
      payload.lastFour = payload.lastFour.trim();
    }
    return this.prisma.finCard.create({
      data: { ...payload, userId },
      include: {
        institution: true,
        balances: true,
        account: { select: { id: true, name: true } },
      },
    });
  }

  updateCard(userId: string, id: string, data: Prisma.FinCardUpdateInput) {
    return this.prisma.finCard
      .updateMany({ where: { id, userId }, data })
      .then(async (result) => {
        if (result.count === 0) return null;
        return this.findCardById(userId, id);
      });
  }

  upsertCardBalance(
    userId: string,
    cardId: string,
    currency: string,
    balance: number,
    creditLimit?: number,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const card = await tx.finCard.findFirst({ where: { id: cardId, userId } });
      if (!card) return null;
      const normalizedCurrency = String(normalizeCurrencyCode(currency));
      const existing = await tx.finCardBalance.findFirst({
        where: { cardId, currency: normalizedCurrency },
      });
      if (existing) {
        return tx.finCardBalance.update({
          where: { id: existing.id },
          data: {
            balance,
            ...(creditLimit !== undefined ? { creditLimit } : {}),
          },
        });
      }
      return tx.finCardBalance.create({
        data: {
          cardId,
          currency: normalizedCurrency,
          balance,
          ...(creditLimit !== undefined ? { creditLimit } : {}),
        },
      });
    });
  }

  listCategories(userId: string) {
    return this.prisma.finCategory.findMany({
      where: { OR: [{ userId }, { isSystem: true }] },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
  }

  createCategory(userId: string, data: Prisma.FinCategoryUncheckedCreateInput) {
    return this.prisma.finCategory.create({
      data: { ...data, userId, isSystem: false },
    });
  }

  updateCategory(userId: string, id: string, data: Prisma.FinCategoryUpdateInput) {
    return this.prisma.finCategory
      .updateMany({ where: { id, userId, isSystem: false }, data })
      .then(async (result) => {
        if (result.count === 0) return null;
        return this.prisma.finCategory.findFirst({ where: { id, userId } });
      });
  }

  deleteCategory(userId: string, id: string) {
    return this.prisma.finCategory.deleteMany({
      where: { id, userId, isSystem: false },
    });
  }
}
