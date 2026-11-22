import { Injectable } from '@nestjs/common';
import { Prisma, PrismaService } from '@personal-os/database';
import {
  CASH_ACCOUNT_TYPE,
  CASH_INSTITUTION_NAME,
  CASH_INSTITUTION_TYPE,
} from '../../shared/domain/cash';

/** The system "Efectivo" institution and the cash accounts that live in it. */
@Injectable()
export class CatalogCashRepository {
  constructor(private readonly prisma: PrismaService) {}

  findSystemCashInstitution(userId: string) {
    return this.prisma.finInstitution.findFirst({
      where: { userId, type: CASH_INSTITUTION_TYPE, isSystem: true },
    });
  }

  createSystemCashInstitution(userId: string) {
    return this.prisma.finInstitution.create({
      data: {
        userId,
        name: CASH_INSTITUTION_NAME,
        type: CASH_INSTITUTION_TYPE,
        country: 'DO',
        isSystem: true,
      },
    });
  }

  findFirstCashAccount(userId: string) {
    return this.prisma.finAccount.findFirst({
      where: { userId, type: CASH_ACCOUNT_TYPE },
      select: { id: true },
    });
  }

  async ensureCashAccount(
    userId: string,
    input: {
      institutionId: string;
      name: string;
      currency: string;
    },
  ): Promise<void> {
    // The institution row serializes concurrent reads: the second one waits,
    // re-checks and finds the account the first one created.
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM fin_institutions WHERE id = ${input.institutionId} FOR UPDATE`,
      );
      const existing = await tx.finAccount.findFirst({
        where: { userId, type: CASH_ACCOUNT_TYPE },
        select: { id: true },
      });
      if (existing) {
        return;
      }
      await tx.finAccount.create({
        data: {
          userId,
          institutionId: input.institutionId,
          name: input.name,
          type: CASH_ACCOUNT_TYPE,
          currency: input.currency,
        },
      });
    });
  }

  assignInstitutionlessCashAccounts(userId: string, institutionId: string) {
    return this.prisma.finAccount.updateMany({
      where: { userId, type: CASH_ACCOUNT_TYPE, institutionId: null },
      data: { institutionId },
    });
  }
}
