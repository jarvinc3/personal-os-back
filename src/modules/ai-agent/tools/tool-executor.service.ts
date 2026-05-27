import { Injectable } from '@nestjs/common';
import type {
  SideEffectDescriptor,
  ToolContext,
  ToolExecutionResult,
} from '../utils/ai.types';
import { UsersService } from '../../users/users.service';
import { mergeWithDefaults } from '../../users/lib/settings-merge';
import { GLOBAL_USER_PREFERENCES_DEFAULTS } from '../../users/defaults/global-preferences-defaults';

@Injectable()
export class ToolExecutorService {
  constructor(private readonly usersService: UsersService) {}

  async getUserContext(ctx: ToolContext): Promise<ToolExecutionResult> {
    const profile = await this.usersService.findById(ctx.userId);
    return {
      success: true,
      message: 'User context loaded',
      data: {
        profile: {
          id: profile.id,
          email: profile.email,
          fullName: profile.fullName,
          avatarUrl: profile.avatarUrl,
          locale: profile.locale,
          timezone: profile.timezone,
          preferences: profile.preferences,
          userModules: profile.userModules,
        },
      },
    };
  }

  async setTheme(
    ctx: ToolContext,
    args: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    const value = args.value as string;
    if (!['system', 'light', 'dark'].includes(value)) {
      return { success: false, message: 'Invalid theme value' };
    }

    const profile = await this.usersService.findById(ctx.userId);
    const prefs = (profile.preferences ?? {}) as Record<string, unknown>;
    const theme = (prefs.theme ?? {}) as Record<string, unknown>;

    await this.usersService.updateProfile(ctx.userId, {
      preferences: {
        theme: { ...theme, value },
      },
    });

    return {
      success: true,
      message: `Theme set to ${value}`,
      sideEffects: [
        { type: 'invalidate', keys: ['profile', 'me'] },
        { type: 'theme', value: value as 'system' | 'light' | 'dark' },
      ],
    };
  }

  async updateUserProfile(
    ctx: ToolContext,
    args: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    const patch: {
      fullName?: string;
      avatarUrl?: string | null;
      locale?: string;
      timezone?: string;
    } = {};

    if (args.fullName !== undefined) {
      if (typeof args.fullName !== 'string' || !args.fullName.trim()) {
        return { success: false, message: 'fullName must be a non-empty string' };
      }
      if (args.fullName.length > 120) {
        return { success: false, message: 'fullName must be at most 120 characters' };
      }
      patch.fullName = args.fullName.trim();
    }

    if (args.avatarUrl !== undefined) {
      if (args.avatarUrl === null) {
        patch.avatarUrl = null;
      } else if (typeof args.avatarUrl === 'string') {
        const url = args.avatarUrl.trim();
        if (url.length > 500) {
          return { success: false, message: 'avatarUrl must be at most 500 characters' };
        }
        if (url.length > 0 && !/^https:\/\//i.test(url)) {
          return {
            success: false,
            message: 'avatarUrl must be an HTTPS URL or null to remove the avatar',
          };
        }
        patch.avatarUrl = url.length > 0 ? url : null;
      } else {
        return { success: false, message: 'avatarUrl must be a string or null' };
      }
    }

    if (args.locale !== undefined) {
      if (typeof args.locale !== 'string' || !args.locale.trim()) {
        return { success: false, message: 'locale must be a non-empty string' };
      }
      if (args.locale.length > 20) {
        return { success: false, message: 'locale must be at most 20 characters' };
      }
      patch.locale = args.locale.trim();
    }

    if (args.timezone !== undefined) {
      if (typeof args.timezone !== 'string' || !args.timezone.trim()) {
        return { success: false, message: 'timezone must be a non-empty string' };
      }
      if (args.timezone.length > 100) {
        return { success: false, message: 'timezone must be at most 100 characters' };
      }
      patch.timezone = args.timezone.trim();
    }

    if (Object.keys(patch).length === 0) {
      return {
        success: false,
        message: 'Provide at least one of: fullName, avatarUrl, locale, timezone',
      };
    }

    const updated = await this.usersService.updateProfile(ctx.userId, patch);

    return {
      success: true,
      message: 'User profile updated',
      data: {
        profile: {
          id: updated.id,
          email: updated.email,
          fullName: updated.fullName,
          avatarUrl: updated.avatarUrl,
          locale: updated.locale,
          timezone: updated.timezone,
        },
      },
      sideEffects: [{ type: 'invalidate', keys: ['profile', 'me'] }],
    };
  }

  async updatePreferences(
    ctx: ToolContext,
    args: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
  const partial = args.preferences as Record<string, unknown> | undefined;
    if (!partial || typeof partial !== 'object') {
      return { success: false, message: 'preferences object required' };
    }

    await this.usersService.updateProfile(ctx.userId, { preferences: partial });

    return {
      success: true,
      message: 'Preferences updated',
      sideEffects: [{ type: 'invalidate', keys: ['profile', 'me'] }],
    };
  }

  async updateAiSettings(
    ctx: ToolContext,
    args: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    const profile = await this.usersService.findById(ctx.userId);
    const prefs = mergeWithDefaults(
      profile.preferences,
      GLOBAL_USER_PREFERENCES_DEFAULTS as unknown as Record<string, unknown>,
    ) as Record<string, unknown>;
    const ai = (prefs.ai ?? {}) as Record<string, unknown>;

    const nextAi = { ...ai };
    if (args.tone !== undefined) nextAi.tone = args.tone;
    if (args.defaultProvider !== undefined) nextAi.defaultProvider = args.defaultProvider;
    if (args.proactiveInsights !== undefined) nextAi.proactiveInsights = args.proactiveInsights;
    if (args.confirmBeforeActions !== undefined) {
      nextAi.confirmBeforeActions = args.confirmBeforeActions;
    }

    await this.usersService.updateProfile(ctx.userId, {
      preferences: { ai: nextAi },
    });

    return {
      success: true,
      message: 'AI settings updated',
      sideEffects: [{ type: 'invalidate', keys: ['profile', 'me'] }],
    };
  }

  async updateNotificationSettings(
    ctx: ToolContext,
    args: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    const patch: Record<string, unknown> = { notifications: {} };
    const notifications = patch.notifications as Record<string, unknown>;
    if (args.channels) notifications.channels = args.channels;
    if (args.quietHours) notifications.quietHours = args.quietHours;

    await this.usersService.updateProfile(ctx.userId, { preferences: patch });

    return {
      success: true,
      message: 'Notification settings updated',
      sideEffects: [{ type: 'invalidate', keys: ['profile', 'me'] }],
    };
  }

  async updateModuleConfig(
    ctx: ToolContext,
    args: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    const slug = args.slug as string;
    const config = args.config as Record<string, unknown>;
    if (!slug || !config) {
      return { success: false, message: 'slug and config required' };
    }
    if (slug === 'finance') {
      return { success: false, message: 'Finance module config is not available via chat' };
    }

    await this.usersService.updateModuleConfig(ctx.userId, slug, { config });

    return {
      success: true,
      message: `Module ${slug} config updated`,
      sideEffects: [
        { type: 'invalidate', keys: ['profile', 'me'] },
        { type: 'invalidate', keys: ['user-module', slug] },
      ],
    };
  }

  async toggleModule(
    ctx: ToolContext,
    args: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    const slug = args.slug as string;
    const isEnabled = args.isEnabled as boolean;
    if (!slug || typeof isEnabled !== 'boolean') {
      return { success: false, message: 'slug and isEnabled required' };
    }

    await this.usersService.updateModuleConfig(ctx.userId, slug, { isEnabled });

    return {
      success: true,
      message: `Module ${slug} ${isEnabled ? 'enabled' : 'disabled'}`,
      sideEffects: [{ type: 'invalidate', keys: ['profile', 'me'] }],
    };
  }

  async execute(
    ctx: ToolContext,
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    switch (name) {
      case 'get_user_context':
        return this.getUserContext(ctx);
      case 'update_user_profile':
        return this.updateUserProfile(ctx, args);
      case 'set_theme':
        return this.setTheme(ctx, args);
      case 'update_preferences':
        return this.updatePreferences(ctx, args);
      case 'update_ai_settings':
        return this.updateAiSettings(ctx, args);
      case 'update_notification_settings':
        return this.updateNotificationSettings(ctx, args);
      case 'update_module_config':
        return this.updateModuleConfig(ctx, args);
      case 'toggle_module':
        return this.toggleModule(ctx, args);
      default:
        return { success: false, message: `Unknown tool: ${name}` };
    }
  }

  mergeSideEffects(results: ToolExecutionResult[]): SideEffectDescriptor[] {
    const seen = new Set<string>();
    const effects: SideEffectDescriptor[] = [];
    for (const r of results) {
      for (const e of r.sideEffects ?? []) {
        const key = JSON.stringify(e);
        if (!seen.has(key)) {
          seen.add(key);
          effects.push(e);
        }
      }
    }
    return effects;
  }
}
