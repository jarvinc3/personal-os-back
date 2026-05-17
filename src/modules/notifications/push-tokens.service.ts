import { Injectable } from '@nestjs/common';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';
import { NotificationsRepository } from './notifications.repository';

@Injectable()
export class PushTokensService {
  constructor(private readonly notificationsRepo: NotificationsRepository) {}

  register(userId: string, dto: RegisterPushTokenDto) {
    return this.notificationsRepo.upsertPushToken({
      userId,
      token: dto.token,
      platform: dto.platform,
    });
  }

  async deactivate(userId: string, token: string) {
    await this.notificationsRepo.deactivatePushToken(token, userId);
    return { success: true };
  }
}
