import { Inject, Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel } from '@personal-os/database';
import {
  DEFAULT_MODULE_CONFIG_BY_SLUG,
  isModuleSlug,
  mergeWithDefaults,
  parseUserPreferences,
  USERS_REPOSITORY,
  type UsersRepositoryPort,
} from '@personal-os/users';
import { isWithinQuietHours } from '../domain/quiet-hours';

export type NotificationDispatchContext = {
  userId: string;
  channel: NotificationChannel;
  data?: Record<string, unknown>;
};

export type PolicyEvaluationResult =
  { allowed: true } | { allowed: false; reason: string };

@Injectable()
export class NotificationPolicyService {
  private readonly logger = new Logger(NotificationPolicyService.name);

  constructor(
    @Inject(USERS_REPOSITORY)
    private readonly usersRepository: UsersRepositoryPort,
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

    const moduleCheck = this.evaluateModuleToggle(
      context.data,
      user.userModules,
    );
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

  private evaluateModuleToggle(
    data: Record<string, unknown> | undefined,
    userModules: NonNullable<
      Awaited<ReturnType<UsersRepositoryPort['findById']>>
    >['userModules'],
  ): PolicyEvaluationResult {
    const moduleSlug = data?.moduleSlug;
    const notificationKey = data?.notificationKey;

    if (typeof moduleSlug !== 'string' || typeof notificationKey !== 'string') {
      return { allowed: true };
    }

    if (!isModuleSlug(moduleSlug)) {
      return { allowed: true };
    }

    const slug = moduleSlug;
    const entry = userModules.find(
      (row) => row.module.slug === slug && row.isEnabled,
    );

    if (!entry) {
      return { allowed: false, reason: 'module_disabled_or_missing' };
    }

    const defaults = DEFAULT_MODULE_CONFIG_BY_SLUG[slug] as unknown as Record<
      string,
      unknown
    >;
    const config = mergeWithDefaults(entry.config, defaults) as {
      notifications?: Record<string, boolean>;
    };

    const toggles = config.notifications ?? {};
    const enabled = toggles[notificationKey];

    if (enabled === false) {
      return {
        allowed: false,
        reason: `module_notification_disabled:${slug}.${notificationKey}`,
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
