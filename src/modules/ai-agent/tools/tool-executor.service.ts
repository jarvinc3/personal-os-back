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
          fullName: profile.fullName,
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
