import { Injectable } from '@nestjs/common';
import { PrismaService } from '@personal-os/database';

type CreateReceivableShareInput = {
  userId: string;
  token: string;
  debtorName: string;
  receivableIds: readonly string[];
};

@Injectable()
export class ReceivableSharesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findReceivablesForShare(userId: string, receivableIds: readonly string[]) {
    return this.prisma.finReceivable.findMany({
      where: { id: { in: [...receivableIds] }, userId },
      select: { id: true },
    });
  }

  createShare(input: CreateReceivableShareInput) {
    return this.prisma.$transaction(async (tx) => {
      const share = await tx.finReceivableShare.create({
        data: {
          userId: input.userId,
          token: input.token,
          debtorName: input.debtorName,
        },
      });
      await tx.finReceivableShareItem.createMany({
        data: input.receivableIds.map((receivableId) => ({
          shareId: share.id,
          receivableId,
        })),
      });
      return share;
    });
  }

  listShares(userId: string) {
    return this.prisma.finReceivableShare.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { items: true } } },
    });
  }

  findShare(userId: string, shareId: string) {
    return this.prisma.finReceivableShare.findFirst({
      where: { id: shareId, userId },
      include: { _count: { select: { items: true } } },
    });
  }

  async revokeShare(userId: string, shareId: string, now: Date) {
    const revoked = await this.prisma.finReceivableShare.updateMany({
      where: { id: shareId, userId },
      data: { isActive: false, revokedAt: now },
    });
    if (revoked.count === 0) {
      return null;
    }
    return this.findShare(userId, shareId);
  }

  /** Rotates the token and reactivates, so the previous URL stops resolving. */
  async rotateShareToken(userId: string, shareId: string, token: string) {
    const rotated = await this.prisma.finReceivableShare.updateMany({
      where: { id: shareId, userId },
      data: { token, isActive: true, revokedAt: null },
    });
    if (rotated.count === 0) {
      return null;
    }
    return this.findShare(userId, shareId);
  }

  findShareByToken(token: string) {
    return this.prisma.finReceivableShare.findUnique({
      where: { token },
      include: {
        user: { select: { fullName: true, timezone: true } },
        items: {
          include: {
            receivable: {
              include: { payments: { orderBy: { paidAt: 'asc' } } },
            },
          },
        },
      },
    });
  }
}
