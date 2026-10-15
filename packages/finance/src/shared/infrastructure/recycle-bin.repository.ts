import { Injectable } from '@nestjs/common';
import { PrismaService } from '@personal-os/database';

@Injectable()
export class RecycleBinRepository {
  constructor(private readonly prisma: PrismaService) {}

  listArchivedInstitutions(userId: string) {
    return this.prisma.finInstitution.findMany({
      where: { userId, isActive: false },
      select: {
        id: true,
        name: true,
        logoPath: true,
        customLogoPath: true,
        logoUrl: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  listArchivedAccounts(userId: string) {
    return this.prisma.finAccount.findMany({
      where: { userId, isActive: false },
      select: {
        id: true,
        name: true,
        institutionRef: {
          select: { logoPath: true, customLogoPath: true, logoUrl: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  listArchivedCards(userId: string) {
    return this.prisma.finCard.findMany({
      where: { userId, isActive: false },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  listArchivedLoans(userId: string) {
    return this.prisma.finLoan.findMany({
      where: { userId, isActive: false },
      select: { id: true, lenderName: true },
      orderBy: { lenderName: 'asc' },
    });
  }

  /**
   * Logos of the named institutions, for the deleted accounts that still point
   * to them.
   */
  listInstitutionLogos(userId: string, ids: readonly string[]) {
    return this.prisma.finInstitution.findMany({
      where: { userId, id: { in: [...ids] } },
      select: {
        id: true,
        logoPath: true,
        customLogoPath: true,
        logoUrl: true,
      },
    });
  }
}
