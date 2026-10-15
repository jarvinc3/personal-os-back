import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@personal-os/core';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';
import { NotificationsService } from '../application/notifications.service';
import { PushTokensService } from '../application/push-tokens.service';

@ApiTags('notifications')
@ApiBearerAuth('access-token')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly pushTokensService: PushTokensService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lista las notificaciones del usuario' })
  list(
    @CurrentUser('sub') userId: string,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.notificationsService.list(userId, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Cantidad de notificaciones sin leer' })
  unreadCount(@CurrentUser('sub') userId: string) {
    return this.notificationsService.unreadCount(userId);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Marca todas las notificaciones como leídas' })
  markAllAsRead(@CurrentUser('sub') userId: string) {
    return this.notificationsService.markAllAsRead(userId);
  }

  @Post()
  @ApiOperation({ summary: 'Crea una notificación para el usuario' })
  create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateNotificationDto,
  ) {
    return this.notificationsService.create(userId, dto);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Marca una notificación como leída' })
  markAsRead(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.notificationsService.markAsRead(id, userId);
  }

  @Post('push-tokens')
  @ApiOperation({ summary: 'Registra un token push del usuario' })
  registerPushToken(
    @CurrentUser('sub') userId: string,
    @Body() dto: RegisterPushTokenDto,
  ) {
    return this.pushTokensService.register(userId, dto);
  }

  @Delete('push-tokens/:token')
  @ApiOperation({ summary: 'Desactiva un token push del usuario' })
  deactivatePushToken(
    @CurrentUser('sub') userId: string,
    @Param('token') token: string,
  ) {
    return this.pushTokensService.deactivate(userId, token);
  }

  @Patch('push-tokens/:token/deactivate')
  @ApiOperation({
    summary: 'Alias deprecado de DELETE push-tokens/:token',
    deprecated: true,
  })
  deactivatePushTokenLegacy(
    @CurrentUser('sub') userId: string,
    @Param('token') token: string,
  ) {
    return this.pushTokensService.deactivate(userId, token);
  }
}
