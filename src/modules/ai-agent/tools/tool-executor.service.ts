import { Injectable } from '@nestjs/common';
import { FinanceService } from '../../finance/finance.service';
import { GLOBAL_USER_PREFERENCES_DEFAULTS } from '../../users/defaults/global-preferences-defaults';
import { mergeWithDefaults } from '../../users/lib/settings-merge';
import { UsersService } from '../../users/users.service';
import { AiSessionsRepository } from '../ai-sessions.repository';
import {
  MODULE_CONTEXT,
  MODULE_CONTEXT_SLUGS,
  MODULE_CONTEXT_SWITCH_TOOL,
  type ModuleContextSlug,
} from '../prompts/module-context';
import type {
  SideEffectDescriptor,
  ToolContext,
  ToolExecutionResult,
} from '../utils/ai.types';

@Injectable()
export class ToolExecutorService {
  constructor(
    private readonly usersService: UsersService,
    private readonly financeService: FinanceService,
    private readonly sessionsRepo: AiSessionsRepository,
  ) {}

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
        return {
          success: false,
          message: 'fullName must be a non-empty string',
        };
      }
      if (args.fullName.length > 120) {
        return {
          success: false,
          message: 'fullName must be at most 120 characters',
        };
      }
      patch.fullName = args.fullName.trim();
    }

    if (args.avatarUrl !== undefined) {
      if (args.avatarUrl === null) {
        patch.avatarUrl = null;
      } else if (typeof args.avatarUrl === 'string') {
        const url = args.avatarUrl.trim();
        if (url.length > 500) {
          return {
            success: false,
            message: 'avatarUrl must be at most 500 characters',
          };
        }
        if (url.length > 0 && !/^https:\/\//i.test(url)) {
          return {
            success: false,
            message:
              'avatarUrl must be an HTTPS URL or null to remove the avatar',
          };
        }
        patch.avatarUrl = url.length > 0 ? url : null;
      } else {
        return {
          success: false,
          message: 'avatarUrl must be a string or null',
        };
      }
    }

    if (args.locale !== undefined) {
      if (typeof args.locale !== 'string' || !args.locale.trim()) {
        return { success: false, message: 'locale must be a non-empty string' };
      }
      if (args.locale.length > 20) {
        return {
          success: false,
          message: 'locale must be at most 20 characters',
        };
      }
      patch.locale = args.locale.trim();
    }

    if (args.timezone !== undefined) {
      if (typeof args.timezone !== 'string' || !args.timezone.trim()) {
        return {
          success: false,
          message: 'timezone must be a non-empty string',
        };
      }
      if (args.timezone.length > 100) {
        return {
          success: false,
          message: 'timezone must be at most 100 characters',
        };
      }
      patch.timezone = args.timezone.trim();
    }

    if (Object.keys(patch).length === 0) {
      return {
        success: false,
        message:
          'Provide at least one of: fullName, avatarUrl, locale, timezone',
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
    );
    const ai = (prefs.ai ?? {}) as Record<string, unknown>;

    const nextAi = { ...ai };
    if (args.tone !== undefined) nextAi.tone = args.tone;
    if (args.defaultProvider !== undefined)
      nextAi.defaultProvider = args.defaultProvider;
    if (args.proactiveInsights !== undefined)
      nextAi.proactiveInsights = args.proactiveInsights;
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
      return {
        success: false,
        message: 'Finance module config is not available via chat',
      };
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

  async switchModuleContext(
    ctx: ToolContext,
    args: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    const slug = args.slug as string;
    if (
      !slug ||
      !MODULE_CONTEXT_SLUGS.includes(slug as ModuleContextSlug)
    ) {
      return {
        success: false,
        message: `Invalid slug. Use one of: ${MODULE_CONTEXT_SLUGS.join(', ')}`,
      };
    }

    let moduleId: string | null = null;
    if (slug !== 'general') {
      const mod = await this.sessionsRepo.findModuleBySlug(slug);
      if (!mod) {
        return { success: false, message: `Module "${slug}" not found` };
      }
      moduleId = mod.id;
    }

    await this.sessionsRepo.updateSession(ctx.sessionId, {
      contextType: slug,
      moduleId,
    });

    const label = MODULE_CONTEXT[slug].label;
    const resolvedSlug = slug === 'general' ? 'general' : slug;

    return {
      success: true,
      message: `Context switched to ${label}`,
      data: { moduleSlug: resolvedSlug, label },
      sideEffects: [{ type: 'moduleContext', slug: resolvedSlug, label }],
    };
  }

  async execute(
    ctx: ToolContext,
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    switch (name) {
      case MODULE_CONTEXT_SWITCH_TOOL:
        return this.switchModuleContext(ctx, args);
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
      case 'get_finance_summary':
        return {
          success: true,
          message: 'Finance summary loaded',
          data: await this.financeService.getAnalyticsSummary(
            ctx.userId,
            args.dateFrom as string | undefined,
            args.dateTo as string | undefined,
          ),
        };
      case 'list_transactions':
        return {
          success: true,
          message: 'Transactions loaded',
          data: await this.financeService.listTransactions(ctx.userId, {
            page: 1,
            limit: 50,
            ...(args),
          }),
        };
      case 'create_transaction':
        return {
          success: true,
          message: 'Transaction created',
          data: await this.financeService.createTransaction(ctx.userId, {
            accountId: args.accountId as string | undefined,
            cardId: args.cardId as string | undefined,
            type: args.type as 'DEBIT' | 'CREDIT' | 'TRANSFER',
            amount: Number(args.amount),
            currency: args.currency as string | undefined,
            transactionDate: args.transactionDate as string,
            description: args.description as string | undefined,
            merchant: args.merchant as string | undefined,
            categoryId: args.categoryId as string | undefined,
          }),
        };
      case 'get_budget_status':
        return {
          success: true,
          message: 'Budget status loaded',
          data: { items: await this.financeService.getBudgetStatus(ctx.userId) },
        };
      case 'create_or_update_budget':
        if (args.budgetId) {
          return {
            success: true,
            message: 'Budget updated',
            data: await this.financeService.updateBudget(ctx.userId, args.budgetId as string, {
              categoryId: args.categoryId as string | undefined,
              periodType: args.periodType as 'MONTHLY' | 'BIWEEKLY' | 'CUSTOM' | undefined,
              periodStart: args.periodStart as string | undefined,
              periodEnd: args.periodEnd as string | undefined,
              amountLimit: args.amountLimit as number | undefined,
              alertThresholdPct: args.alertThresholdPct as number | undefined,
            }),
          };
        }
        return {
          success: true,
          message: 'Budget created',
          data: await this.financeService.createBudget(ctx.userId, {
            categoryId: args.categoryId as string,
            periodType: args.periodType as 'MONTHLY' | 'BIWEEKLY' | 'CUSTOM',
            periodStart: args.periodStart as string,
            periodEnd: args.periodEnd as string,
            amountLimit: Number(args.amountLimit),
            alertThresholdPct: args.alertThresholdPct as number | undefined,
          }),
        };
      case 'list_savings_goals':
        return {
          success: true,
          message: 'Savings goals loaded',
          data: { items: await this.financeService.listSavingsGoals(ctx.userId) },
        };
      case 'create_savings_goal':
        return {
          success: true,
          message: 'Savings goal created',
          data: await this.financeService.createSavingsGoal(ctx.userId, {
            name: args.name as string,
            targetAmount: Number(args.targetAmount),
            currentAmount: args.currentAmount as number | undefined,
            currency: args.currency as string | undefined,
            targetDate: args.targetDate as string | undefined,
          }),
        };
      case 'update_savings_goal':
        return {
          success: true,
          message: 'Savings goal updated',
          data: await this.financeService.updateSavingsGoal(
            ctx.userId,
            args.goalId as string,
            {
              currentAmount: args.currentAmount as number | undefined,
              targetAmount: args.targetAmount as number | undefined,
              name: args.name as string | undefined,
            },
          ),
        };
      case 'list_loans':
        return {
          success: true,
          message: 'Loans loaded',
          data: { items: await this.financeService.listLoans(ctx.userId) },
        };
      case 'mark_loan_installment_paid': {
        const loans = await this.financeService.listLoans(ctx.userId);
        const loan = loans.find((item) => item.id === args.loanId);
        if (!loan) {
          return { success: false, message: 'Loan not found' };
        }
        return {
          success: true,
          message: 'Loan installment marked as paid',
          data: await this.financeService.updateLoan(ctx.userId, args.loanId as string, {
            paidInstallments: loan.paidInstallments + 1,
            currentBalance: Number(loan.currentBalance) - Number(loan.installmentAmount),
          }),
        };
      }
      case 'trigger_email_sync':
        return {
          success: true,
          message: 'Email sync queued',
          data: await this.financeService.triggerEmailSync(
            ctx.userId,
            args.sourceId as string,
          ),
        };
      case 'get_spending_by_category':
        return {
          success: true,
          message: 'Spending breakdown loaded',
          data: {
            items: await this.financeService.getSpendingByCategory(
              ctx.userId,
              args.dateFrom as string | undefined,
              args.dateTo as string | undefined,
            ),
          },
        };
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
