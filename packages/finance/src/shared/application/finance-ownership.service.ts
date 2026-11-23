import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '@personal-os/database';
import { isCashInstitution } from '../domain/cash';
import {
  categoryTypeForTransaction,
  type FinCategoryTypeValue,
} from '../domain/category-type';

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
      throw new BadRequestException('Institución no encontrada');
    }
    return institution;
  }

  /**
   * Cards, loans and email sources belong to banks: the cash institution
   * (system "Efectivo" or a legacy cash one) is rejected.
   */
  async assertInstitutionAcceptsBankProducts(
    userId: string,
    institutionId: string,
  ) {
    const institution = await this.assertInstitutionOwned(
      userId,
      institutionId,
    );
    if (isCashInstitution(institution)) {
      throw new BadRequestException(
        'Efectivo no admite tarjetas, préstamos ni sincronización por correo',
      );
    }
    return institution;
  }

  async assertAccountOwned(userId: string, accountId: string) {
    const account = await this.prisma.finAccount.findFirst({
      where: { id: accountId, userId },
    });
    if (!account) {
      throw new BadRequestException('Cuenta no encontrada');
    }
    return account;
  }

  async assertCardOwned(userId: string, cardId: string) {
    const card = await this.prisma.finCard.findFirst({
      where: { id: cardId, userId },
    });
    if (!card) {
      throw new BadRequestException('Tarjeta no encontrada');
    }
    return card;
  }

  async assertCategoryVisible(userId: string, categoryId: string) {
    const category = await this.prisma.finCategory.findFirst({
      where: { id: categoryId, ...VISIBLE_CATEGORY(userId) },
    });
    if (!category) {
      throw new BadRequestException('Categoría no encontrada');
    }
    return category;
  }

  assertCategoryMatchesTransactionType(
    category: { type: FinCategoryTypeValue },
    transactionType: 'DEBIT' | 'CREDIT' | 'TRANSFER',
  ) {
    const expected = categoryTypeForTransaction(transactionType);
    if (!expected || category.type !== expected) {
      throw new BadRequestException(
        'Category type does not match the transaction type',
      );
    }
  }

  async assertExpenseCategory(userId: string, categoryId: string) {
    const category = await this.assertCategoryVisible(userId, categoryId);
    if (category.type !== 'EXPENSE') {
      throw new BadRequestException(
        'Los presupuestos requieren una categoría de gasto',
      );
    }
    return category;
  }

  async assertParentCategory(input: {
    userId: string;
    parentId: string;
    childId?: string;
    expectedType?: FinCategoryTypeValue;
  }) {
    const { userId, parentId, childId, expectedType } = input;
    const parent = await this.assertCategoryVisible(userId, parentId);
    if (childId && parentId === childId) {
      throw new BadRequestException(
        'Una categoría no puede ser su propia padre',
      );
    }

    const requiredType = await this.requiredParentType({
      childId,
      expectedType,
    });
    if (requiredType && parent.type !== requiredType) {
      throw new BadRequestException(
        'La categoría padre debe tener el mismo tipo',
      );
    }

    if (childId) {
      await this.assertNoCategoryCycle({ parentId: parent.id, childId });
    }
    return parent;
  }

  private async requiredParentType(input: {
    childId?: string;
    expectedType?: FinCategoryTypeValue;
  }): Promise<FinCategoryTypeValue | undefined> {
    if (input.expectedType) {
      return input.expectedType;
    }
    if (!input.childId) {
      return undefined;
    }
    const child = await this.prisma.finCategory.findFirst({
      where: { id: input.childId },
      select: { type: true },
    });
    return child?.type;
  }

  private async assertNoCategoryCycle(input: {
    parentId: string;
    childId: string;
  }): Promise<void> {
    let cursor: string | null = input.parentId;
    const seen = new Set<string>([input.childId]);
    while (cursor) {
      if (seen.has(cursor)) {
        throw new BadRequestException('La categoría padre crearía un ciclo');
      }
      seen.add(cursor);
      const row = await this.prisma.finCategory.findFirst({
        where: { id: cursor },
        select: { parentId: true },
      });
      cursor = row?.parentId ?? null;
    }
  }

  async assertDebitAccountAlignment(params: {
    userId: string;
    accountId: string;
    institutionId: string;
  }) {
    const account = await this.assertAccountOwned(
      params.userId,
      params.accountId,
    );
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
    const account = await this.assertAccountOwned(
      params.userId,
      params.accountId,
    );
    if (
      params.institutionId &&
      account.institutionId !== params.institutionId
    ) {
      throw new BadRequestException(
        'La cuenta de pago del préstamo debe ser de la misma institución',
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
          'No se puede cambiar la institución de la cuenta mientras tenga tarjetas de débito en otra',
        debitCardIds: incompatible.map((card) => card.id),
      });
    }
  }

  async assertInstitutionCanArchive(userId: string, institutionId: string) {
    const [accounts, cards, loans] = await Promise.all([
      this.prisma.finAccount.count({
        where: { userId, institutionId, isActive: true },
      }),
      this.prisma.finCard.count({
        where: { userId, institutionId, isActive: true },
      }),
      this.prisma.finLoan.count({
        where: { userId, institutionId, isActive: true },
      }),
    ]);
    if (accounts + cards + loans > 0) {
      throw new ConflictException({
        message:
          'No se puede archivar la institución mientras tenga cuentas, tarjetas o préstamos activos',
        dependents: { accounts, cards, loans },
      });
    }
  }
}
