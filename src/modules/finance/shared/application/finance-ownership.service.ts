import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';

const VISIBLE_CATEGORY = (userId: string) => ({
  OR: [{ userId }, { isSystem: true }],
});

@Injectable()
export class FinanceOwnershipService {
  constructor(private readonly prisma: PrismaService) {}

  async assertInstitutionOwned(userId: string, institutionId: string) {
    const institution = await this.prisma.finInstitution.findFirst({
      where: { id: institutionId, userId },
    });
    if (!institution) {
      throw new BadRequestException('Institution not found');
    }
    return institution;
  }

  async assertAccountOwned(userId: string, accountId: string) {
    const account = await this.prisma.finAccount.findFirst({
      where: { id: accountId, userId },
    });
    if (!account) {
      throw new BadRequestException('Account not found');
    }
    return account;
  }

  async assertCardOwned(userId: string, cardId: string) {
    const card = await this.prisma.finCard.findFirst({
      where: { id: cardId, userId },
    });
    if (!card) {
      throw new BadRequestException('Card not found');
    }
    return card;
  }

  async assertCategoryVisible(userId: string, categoryId: string) {
    const category = await this.prisma.finCategory.findFirst({
      where: { id: categoryId, ...VISIBLE_CATEGORY(userId) },
    });
    if (!category) {
      throw new BadRequestException('Category not found');
    }
    return category;
  }

  async assertParentCategory(userId: string, parentId: string, childId?: string) {
    const parent = await this.assertCategoryVisible(userId, parentId);
    if (childId && parentId === childId) {
      throw new BadRequestException('Category cannot be its own parent');
    }
    if (childId) {
      let cursor: string | null = parent.id;
      const seen = new Set<string>([childId]);
      while (cursor) {
        if (seen.has(cursor)) {
          throw new BadRequestException('Category parent would create a cycle');
        }
        seen.add(cursor);
        const row = await this.prisma.finCategory.findFirst({
          where: { id: cursor },
          select: { parentId: true },
        });
        cursor = row?.parentId ?? null;
      }
    }
    return parent;
  }

  async assertDebitAccountAlignment(params: {
    userId: string;
    accountId: string;
    institutionId: string;
  }) {
    const account = await this.assertAccountOwned(params.userId, params.accountId);
    if (account.institutionId !== params.institutionId) {
      throw new BadRequestException(
        'DEBIT cards require an account from the same institution',
      );
    }
    return account;
  }

  async assertLoanAccountAlignment(params: {
    userId: string;
    accountId: string;
    institutionId?: string | null;
  }) {
    const account = await this.assertAccountOwned(params.userId, params.accountId);
    if (params.institutionId && account.institutionId !== params.institutionId) {
      throw new BadRequestException(
        'Loan payment account must belong to the same institution',
      );
    }
    return account;
  }

  async assertAccountInstitutionChangeAllowed(params: {
    userId: string;
    accountId: string;
    nextInstitutionId: string | null;
  }) {
    const debitCards = await this.prisma.finCard.findMany({
      where: {
        userId: params.userId,
        accountId: params.accountId,
        type: 'DEBIT',
        isActive: true,
      },
      select: { id: true, institutionId: true, name: true },
    });
    const incompatible = debitCards.filter(
      (card) =>
        params.nextInstitutionId === null ||
        card.institutionId !== params.nextInstitutionId,
    );
    if (incompatible.length > 0) {
      throw new ConflictException({
        message:
          'Cannot change account institution while debit cards remain on another institution',
        debitCardIds: incompatible.map((card) => card.id),
      });
    }
  }

  async assertInstitutionCanArchive(userId: string, institutionId: string) {
    const [accounts, cards, sources, loans] = await Promise.all([
      this.prisma.finAccount.count({
        where: { userId, institutionId, isActive: true },
      }),
      this.prisma.finCard.count({
        where: { userId, institutionId, isActive: true },
      }),
      this.prisma.finEmailSource.count({
        where: { userId, institutionId, isActive: true },
      }),
      this.prisma.finLoan.count({
        where: { userId, institutionId, isActive: true },
      }),
    ]);
    if (accounts + cards + sources + loans > 0) {
      throw new ConflictException({
        message:
          'Cannot archive institution while active accounts, cards, email sources, or loans remain',
        dependents: { accounts, cards, emailSources: sources, loans },
      });
    }
  }
}
