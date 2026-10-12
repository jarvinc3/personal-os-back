import { Injectable } from '@nestjs/common';
import { PrismaService } from '@personal-os/database';

@Injectable()
export class RecycleBinRepository {
  constructor(private readonly prisma: PrismaService) {}

  listArchivedInstitutions(userId: string) {
    return this.prisma.finInstitution.findMany({
      where: { userId, isActive: false },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  listArchivedAccounts(userId: string) {
    return this.prisma.finAccount.findMany({
      where: { userId, isActive: false },
      select: { id: true, name: true },
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
}
