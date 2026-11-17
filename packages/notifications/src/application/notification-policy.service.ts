import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  MODULE_SETTINGS_READER,
  type ModuleSettingsReader,
} from '@personal-os/contracts';
import type { NotificationChannel } from '@personal-os/database';
import {
  parseUserPreferences,
  USERS_REPOSITORY,
  type UsersRepositoryPort,
} from '@personal-os/users';
import { isWithinQuietHours } from '../domain/quiet-hours';

export type NotificationDispatchContext = {
  userId: string;
  channel: NotificationChannel;
  data?: Record<string, unknown>;
  /** Module that owns the preference; falls back to `data.moduleSlug`. */
  moduleSlug?: string;
  /** Preference toggle; falls back to `data.notificationKey`. */
  preferenceKey?: string;
};

export type PolicyEvaluationResult =
  { allowed: true } | { allowed: false; reason: string };

@Injectable()
export class NotificationPolicyService {
  private readonly logger = new Logger(NotificationPolicyService.name);

  constructor(
    @Inject(USERS_REPOSITORY)
    private readonly usersRepository: UsersRepositoryPort,
    @Inject(MODULE_SETTINGS_READER)
    private readonly settings: ModuleSettingsReader,
  ) {}

  async evaluate(
    context: NotificationDispatchContext,
  ): Promise<PolicyEvaluationResult> {
    const user = await this.usersRepository.findById(context.userId);
    if (!user) {
      return { allowed: false, reason: 'user_not_found' };
    }

    const prefs = parseUserPreferences(user.preferences, {
      timezone: user.timezone,
      locale: user.locale,
    });

    const moduleCheck = await this.evaluateModuleToggle(context);
    if (!moduleCheck.allowed) {
      return moduleCheck;
    }

    const channelCheck = this.evaluateChannel(
      context.channel,
      prefs,
      user.timezone,
    );
    if (!channelCheck.allowed) {
      return channelCheck;
    }

    return { allowed: true };
  }

  async isInAppListingEnabled(userId: string): Promise<boolean> {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      return false;
    }
    const prefs = parseUserPreferences(user.preferences, {
      timezone: user.timezone,
      locale: user.locale,
    });
    return prefs.notifications.channels.inApp;
  }

  private evaluateChannel(
    channel: NotificationChannel,
    prefs: ReturnType<typeof parseUserPreferences>,
    timezone: string,
  ): PolicyEvaluationResult {
    const { channels, quietHours } = prefs.notifications;

    if (channel === 'IN_APP' && !channels.inApp) {
      return { allowed: false, reason: 'channel_in_app_disabled' };
    }

    if (channel === 'PUSH' && !channels.push) {
      return { allowed: false, reason: 'channel_push_disabled' };
    }

    if (channel === 'EMAIL' && !channels.email) {
      return { allowed: false, reason: 'channel_email_disabled' };
    }

    if (channel === 'PUSH' || channel === 'EMAIL') {
      const quiet = isWithinQuietHours({
        enabled: quietHours.enabled,
        start: quietHours.start,
        end: quietHours.end,
        timezone: quietHours.timezone ?? timezone,
      });
      if (quiet) {
        return { allowed: false, reason: 'quiet_hours_active' };
      }
    }

    return { allowed: true };
  }

  /** The module owner declares the toggle; Notifications only asks for it. */
  private async evaluateModuleToggle(
    context: NotificationDispatchContext,
  ): Promise<PolicyEvaluationResult> {
    const moduleSlug = context.moduleSlug ?? context.data?.moduleSlug;
    const notificationKey =
      context.preferenceKey ?? context.data?.notificationKey;

    if (typeof moduleSlug !== 'string' || typeof notificationKey !== 'string') {
      return { allowed: true };
    }

    if (!this.settings.hasDescriptor(moduleSlug)) {
      return { allowed: true };
    }

    const module = await this.settings.read(context.userId, moduleSlug);
    if (!module.enabled) {
      return { allowed: false, reason: 'module_disabled_or_missing' };
    }

    const enabled = await this.settings.notificationEnabled(
      context.userId,
      moduleSlug,
      notificationKey,
    );
    if (!enabled) {
      return {
        allowed: false,
        reason: `module_notification_disabled:${moduleSlug}.${notificationKey}`,
      };
    }

    return { allowed: true };
  }

  logSkipped(context: NotificationDispatchContext, reason: string): void {
    this.logger.debug(
      `Notification skipped for user ${context.userId} channel ${context.channel}: ${reason}`,
    );
  }
}
