import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppEvents } from '../../core/events/event.constants';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsRepository } from './notifications.repository';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly notificationsRepo: NotificationsRepository,
    private readonly notificationsGateway: NotificationsGateway,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(dto: CreateNotificationDto) {
    const created = await this.notificationsRepo.createNotification({
      userId: dto.userId,
      type: dto.type,
      channel: dto.channel,
      title: dto.title,
      body: dto.body,
      data: dto.data,
    });

    this.notificationsGateway.emitToUser(created.userId, 'notification.new', {
      id: created.id,
      type: created.type,
      title: created.title,
      body: created.body,
      data: created.data,
      createdAt: created.createdAt,
    });

    this.eventEmitter.emit(AppEvents.AI_ACTION_COMPLETED, {
      userId: created.userId,
      actionType: 'notification.created',
      payload: { notificationId: created.id },
    });

    return created;
  }

  markAsRead(id: string, userId: string) {
    return this.notificationsRepo.markAsRead(id, userId);
  }
}
