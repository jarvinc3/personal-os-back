import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../core/decorators';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';
import { NotificationsService } from './notifications.service';
import { PushTokensService } from './push-tokens.service';

@ApiTags('notifications')
@ApiBearerAuth('access-token')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly pushTokensService: PushTokensService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a notification and broadcast to user room' })
  create(@Body() dto: CreateNotificationDto) {
    return this.notificationsService.create(dto);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark notification as read for current user' })
  markAsRead(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.notificationsService.markAsRead(id, userId);
  }

  @Post('push-tokens')
  @ApiOperation({ summary: 'Register a push token for current user' })
  registerPushToken(
    @CurrentUser('sub') userId: string,
    @Body() dto: RegisterPushTokenDto,
  ) {
    return this.pushTokensService.register(userId, dto);
  }

  @Patch('push-tokens/:token/deactivate')
  @ApiOperation({ summary: 'Deactivate a push token for current user' })
  deactivatePushToken(
    @CurrentUser('sub') userId: string,
    @Param('token') token: string,
  ) {
    return this.pushTokensService.deactivate(userId, token);
  }
}
