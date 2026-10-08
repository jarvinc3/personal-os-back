import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { AppEvents } from '@personal-os/core';
import {
  expandWipeLayers,
  WIPE_LAYERS,
  type WipeLayerId,
} from '../domain/wipe-layers';
import {
  USERS_REPOSITORY,
  type UsersRepositoryPort,
} from './ports/users.repository.port';
import {
  USER_DATA_WIPE_DOMAINS,
  type UserDataWipeDomainsPort,
} from './ports/user-data-wipe-domains.port';

const FINANCE_LAYER_PREFIX = 'finance.';

export type WipeUserDataResult = {
  success: true;
  requestedLayers: WipeLayerId[];
  appliedLayers: WipeLayerId[];
  counts: Record<string, number>;
};

/**
 * Expands the requested layers, fans out to the domain ports and emits one
 * aggregated event. Finance/ai/notifications never see a per-row event here.
 */
@Injectable()
export class WipeUserDataUseCase {
  private readonly logger = new Logger(WipeUserDataUseCase.name);

  constructor(
    @Inject(USERS_REPOSITORY)
    private readonly usersRepository: UsersRepositoryPort,
    @Inject(USER_DATA_WIPE_DOMAINS)
    private readonly domains: UserDataWipeDomainsPort,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async execute(
    userId: string,
    requestedLayers: WipeLayerId[],
  ): Promise<WipeUserDataResult> {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const appliedLayers = expandWipeLayers(requestedLayers);
    const counts: Record<string, number> = {};

    if (appliedLayers.includes(WIPE_LAYERS.FINANCE_LEDGER)) {
      await this.usersRepository.pauseFinanceEmailSyncAutomatic(userId);
    }

    const financeLayers = appliedLayers.filter((layer) =>
      layer.startsWith(FINANCE_LAYER_PREFIX),
    );
    if (financeLayers.length > 0) {
      Object.assign(
        counts,
        await this.domains.wipeFinance(userId, financeLayers),
      );
    }
    if (appliedLayers.includes(WIPE_LAYERS.AI_SESSIONS)) {
      Object.assign(counts, await this.domains.wipeAi(userId));
    }
    if (appliedLayers.includes(WIPE_LAYERS.NOTIFICATIONS)) {
      Object.assign(counts, await this.domains.wipeNotifications(userId));
    }
    if (appliedLayers.includes(WIPE_LAYERS.SETTINGS_DEFAULTS)) {
      await this.usersRepository.resetSettingsToDefaults(userId);
    }

    this.eventEmitter.emit(AppEvents.USER_DATA_WIPED, {
      eventId: randomUUID(),
      userId,
      requestedLayers,
      appliedLayers,
      counts,
    });
    this.logger.log(
      `user_data_wiped userId=${userId} requested=${requestedLayers.join(',')} applied=${appliedLayers.join(',')}`,
    );

    return {
      success: true,
      requestedLayers,
      appliedLayers,
      counts,
    };
  }
}
