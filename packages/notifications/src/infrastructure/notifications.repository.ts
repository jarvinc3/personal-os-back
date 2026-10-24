import { Injectable } from '@nestjs/common';
import { clampPageLimit, decodeCursor } from '@personal-os/core';
import type { NotificationChannel, Prisma } from '@personal-os/database';
import { PrismaService } from '@personal-os/database';
import type { ListNotificationsQueryDto } from '../presentation/dto/list-notifications-query.dto';

@Injectable()
export class NotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  createNotification(data: {
    userId: string;
    type: string;
    channel: NotificationChannel;
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

  findByUser(userId: string, query: ListNotificationsQueryDto) {
    const limit = clampPageLimit(query.limit);
    const cursorPoint = query.cursor ? decodeCursor(query.cursor) : null;
    const channel = query.channel ?? 'IN_APP';

    const baseWhere: Prisma.NotificationWhereInput = {
      userId,
      channel,
      ...(query.unreadOnly ? { isRead: false } : {}),
    };
    const cursorDate = cursorPoint ? new Date(cursorPoint.key) : null;
    const where: Prisma.NotificationWhereInput =
      cursorPoint && cursorDate
        ? {
            AND: [
              baseWhere,
              {
                OR: [
                  { createdAt: { lt: cursorDate } },
                  { createdAt: cursorDate, id: { lt: cursorPoint.id } },
                ],
              },
            ],
          }
        : baseWhere;

    return this.prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
  }

  countUnread(userId: string, channel: NotificationChannel = 'IN_APP') {
    return this.prisma.notification.count({
      where: { userId, channel, isRead: false },
    });
  }

  markAsRead(id: string, userId: string) {
    return this.prisma.notification.update({
      where: { id, userId },
      data: { isRead: true, sentAt: new Date() },
    });
  }

  markAllAsRead(userId: string, channel: NotificationChannel = 'IN_APP') {
    return this.prisma.notification.updateMany({
      where: { userId, channel, isRead: false },
      data: { isRead: true, sentAt: new Date() },
    });
  }

  upsertPushToken(data: { userId: string; token: string; platform: string }) {
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

  deactivatePushTokenByToken(token: string) {
    return this.prisma.pushToken.updateMany({
      where: { token },
      data: { isActive: false },
    });
  }

  findActivePushTokens(userId: string) {
    return this.prisma.pushToken.findMany({
      where: {
        userId,
        isActive: true,
      },
      select: {
        token: true,
        platform: true,
      },
    });
  }

  countAllForUser(userId: string) {
    return this.prisma.notification.count({ where: { userId } });
  }

  countAllPushTokensForUser(userId: string) {
    return this.prisma.pushToken.count({ where: { userId } });
  }

  deleteAllForUser(userId: string) {
    return this.prisma.notification.deleteMany({ where: { userId } });
  }

  deleteAllPushTokensForUser(userId: string) {
    return this.prisma.pushToken.deleteMany({ where: { userId } });
  }
}
