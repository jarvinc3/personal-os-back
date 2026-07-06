import { Injectable } from '@nestjs/common';
import { paginationArgs } from '../../core/pagination/pagination.dto';
import type { NotificationChannel, Prisma } from '../../prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';

@Injectable()
export class NotificationsRepository {
  constructor(private readonly prisma: PrismaService) { }

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
    const { skip, take } = paginationArgs(query);
    const channel = query.channel ?? 'IN_APP';

    const where: Prisma.NotificationWhereInput = {
      userId,
      channel,
      ...(query.unreadOnly ? { isRead: false } : {}),
    };

    return this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.notification.count({ where }),
    ]);
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
}
