import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class NotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  createNotification(data: {
    userId: string;
    type: string;
    channel: 'IN_APP' | 'PUSH' | 'EMAIL';
    title: string;
    body: string;
    data?: Record<string, unknown>;
  }) {
    return this.prisma.notification.create({
      data: {
        userId: data.userId,
        type: data.type,
        channel: data.channel,
        title: data.title,
        body: data.body,
        data: (data.data ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  markAsRead(id: string, userId: string) {
    return this.prisma.notification.update({
      where: { id, userId },
      data: { isRead: true, sentAt: new Date() },
    });
  }

  upsertPushToken(data: {
    userId: string;
    token: string;
    platform: string;
  }) {
    return this.prisma.pushToken.upsert({
      where: { token: data.token },
      update: {
        isActive: true,
        userId: data.userId,
        platform: data.platform,
      },
      create: {
        token: data.token,
        userId: data.userId,
        platform: data.platform,
      },
    });
  }

  deactivatePushToken(token: string, userId: string) {
    return this.prisma.pushToken.updateMany({
      where: {
        token,
        userId,
      },
      data: { isActive: false },
    });
  }
}
