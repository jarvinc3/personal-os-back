import { Injectable } from '@nestjs/common';
import { FinanceFacade } from '../../finance';
import {
  GLOBAL_USER_PREFERENCES_DEFAULTS,
  mergeWithDefaults,
  UsersService,
} from '../../users';
import { AiSessionsRepository } from '../chat/infrastructure/ai-sessions.repository';
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
} from '../shared/ai.types';
import {
  type MutatingToolName,
  type ValidatedToolArgs,
  validateMutatingToolArgs,
} from './tool-arg-schemas';

const FINANCE_TOOL_NAMES = new Set([
  'get_finance_summary',
  'list_transactions',
  'get_transaction',
  'list_categories',
  'list_accounts',
  'list_cards',
  'list_budgets',
  'list_email_sources',
  'create_transaction',
  'create_transfer',
  'update_transaction',
  'confirm_transaction',
  'get_budget_status',
  'create_or_update_budget',
  'list_savings_goals',
  'create_savings_goal',
  'update_savings_goal',
  'list_loans',
  'mark_loan_installment_paid',
  'trigger_email_sync',
  'get_spending_by_category',
  'get_spending_over_time',
]);

@Injectable()
export class ToolExecutorService {
  constructor(
    private readonly usersService: UsersService,
    private readonly financeFacade: FinanceFacade,
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
    args: ValidatedToolArgs<'set_theme'>,
  ): Promise<ToolExecutionResult> {
    const { value } = args;
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
        { type: 'theme', value },
      ],
    };
  }

  async updateUserProfile(
    ctx: ToolContext,
    args: ValidatedToolArgs<'update_user_profile'>,
  ): Promise<ToolExecutionResult> {
    const patch: {
      fullName?: string;
      avatarUrl?: string | null;
      locale?: string;
      timezone?: string;
    } = {};

    if (args.fullName !== undefined) {
      patch.fullName = args.fullName;
    }

    if (args.avatarUrl !== undefined) {
      if (args.avatarUrl === null) {
        patch.avatarUrl = null;
      } else {
        const url = args.avatarUrl.trim();
        patch.avatarUrl = url.length > 0 ? url : null;
      }
    }

    if (args.locale !== undefined) {
      patch.locale = args.locale;
    }

    if (args.timezone !== undefined) {
      patch.timezone = args.timezone;
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
    args: ValidatedToolArgs<'update_preferences'>,
  ): Promise<ToolExecutionResult> {
    await this.usersService.updateProfile(ctx.userId, {
      preferences: args.preferences,
    });

    return {
      success: true,
      message: 'Preferences updated',
      sideEffects: [{ type: 'invalidate', keys: ['profile', 'me'] }],
    };
  }

  async updateAiSettings(
    ctx: ToolContext,
    args: ValidatedToolArgs<'update_ai_settings'>,
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
    args: ValidatedToolArgs<'update_notification_settings'>,
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
    args: ValidatedToolArgs<'update_module_config'>,
  ): Promise<ToolExecutionResult> {
    const { slug, config } = args;

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
    args: ValidatedToolArgs<'toggle_module'>,
  ): Promise<ToolExecutionResult> {
    const { slug, isEnabled } = args;

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
    if (!slug || !MODULE_CONTEXT_SLUGS.includes(slug as ModuleContextSlug)) {
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
    if (args.__parseError !== undefined) {
      return {
        success: false,
        message:
          typeof args.__parseError === 'string'
            ? args.__parseError
            : 'Tool arguments are not valid JSON',
      };
    }

    const validation = validateMutatingToolArgs(name, args);
    if (!validation.ok) {
      return { success: false, message: validation.message };
    }
    const validated = validation.data;

    try {
      return await this.dispatch(ctx, name, validated);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Tool execution failed: ${message}`,
      };
    }
  }

  private async dispatch(
    ctx: ToolContext,
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    if (FINANCE_TOOL_NAMES.has(name)) {
      await this.usersService.assertModuleEnabled(ctx.userId, 'finance');
    }

    switch (name) {
      case MODULE_CONTEXT_SWITCH_TOOL:
        return this.switchModuleContext(ctx, args);
      case 'get_user_context':
        return this.getUserContext(ctx);
      case 'update_user_profile':
        return this.updateUserProfile(ctx, args);
      case 'set_theme':
        return this.setTheme(ctx, args as ValidatedToolArgs<'set_theme'>);
      case 'update_preferences':
        return this.updatePreferences(
          ctx,
          args as ValidatedToolArgs<'update_preferences'>,
        );
      case 'update_ai_settings':
        return this.updateAiSettings(ctx, args);
      case 'update_notification_settings':
        return this.updateNotificationSettings(ctx, args);
      case 'update_module_config':
        return this.updateModuleConfig(
          ctx,
          args as ValidatedToolArgs<'update_module_config'>,
        );
      case 'toggle_module':
        return this.toggleModule(
          ctx,
          args as ValidatedToolArgs<'toggle_module'>,
        );
      case 'get_finance_summary':
        return {
          success: true,
          message: 'Finance summary loaded',
          data: await this.financeFacade.getAnalyticsSummary(
            ctx.userId,
            typeof args.dateFrom === 'string' ? args.dateFrom : undefined,
            typeof args.dateTo === 'string' ? args.dateTo : undefined,
          ),
        };
      case 'list_transactions':
        return {
          success: true,
          message: 'Transactions loaded',
          data: await this.financeFacade.listTransactions(ctx.userId, {
            page: 1,
            limit: 50,
            ...args,
          }),
        };
      case 'get_transaction': {
        const id =
          typeof args.transactionId === 'string' ? args.transactionId : '';
        if (!id) {
          return { success: false, message: 'transactionId is required' };
        }
        return {
          success: true,
          message: 'Transaction loaded',
          data: await this.financeFacade.getTransaction(ctx.userId, id),
        };
      }
      case 'list_categories':
        return {
          success: true,
          message: 'Categories loaded',
          data: { items: await this.financeFacade.listCategories(ctx.userId) },
        };
      case 'list_accounts':
        return {
          success: true,
          message: 'Accounts loaded',
          data: { items: await this.financeFacade.listAccounts(ctx.userId) },
        };
      case 'list_cards':
        return {
          success: true,
          message: 'Cards loaded',
          data: { items: await this.financeFacade.listCards(ctx.userId) },
        };
      case 'list_budgets':
        return {
          success: true,
          message: 'Budgets loaded',
          data: { items: await this.financeFacade.listBudgets(ctx.userId) },
        };
      case 'list_email_sources':
        return {
          success: true,
          message: 'Email sources loaded',
          data: {
            items: await this.financeFacade.listEmailSources(ctx.userId),
          },
        };
      case 'create_transaction': {
        const tx = args as ValidatedToolArgs<'create_transaction'>;
        return {
          success: true,
          message: 'Transaction created',
          data: await this.financeFacade.createTransaction(
            ctx.userId,
            {
              accountId: tx.accountId ?? undefined,
              cardId: tx.cardId ?? undefined,
              type: tx.type,
              amount: tx.amount,
              currency: tx.currency,
              transactionDate: tx.transactionDate,
              description: tx.description ?? undefined,
              merchant: tx.merchant ?? undefined,
              categoryId: tx.categoryId ?? undefined,
            },
            'AI',
          ),
        };
      }
      case 'create_transfer': {
        const t = args as ValidatedToolArgs<'create_transfer'>;
        return {
          success: true,
          message: 'Transfer created',
          data: await this.financeFacade.createTransferTransaction(ctx.userId, {
            fromAccountId: t.fromAccountId ?? undefined,
            fromCardId: t.fromCardId ?? undefined,
            toAccountId: t.toAccountId ?? undefined,
            toCardId: t.toCardId ?? undefined,
            amount: t.amount,
            currency: t.currency,
            transactionDate: t.transactionDate,
            description: t.description ?? undefined,
            notes: t.notes ?? undefined,
          }),
        };
      }
      case 'update_transaction': {
        const tx = args as ValidatedToolArgs<'update_transaction'>;
        return {
          success: true,
          message: 'Transaction updated',
          data: await this.financeFacade.updateTransaction(
            ctx.userId,
            tx.transactionId,
            {
              categoryId: tx.categoryId ?? undefined,
              merchant: tx.merchant ?? undefined,
              description: tx.description ?? undefined,
              notes: tx.notes ?? undefined,
            },
          ),
        };
      }
      case 'confirm_transaction': {
        const tx = args as ValidatedToolArgs<'confirm_transaction'>;
        return {
          success: true,
          message: 'Transaction confirmed',
          data: await this.financeFacade.confirmTransaction(
            ctx.userId,
            tx.transactionId,
          ),
        };
      }
      case 'get_budget_status':
        return {
          success: true,
          message: 'Budget status loaded',
          data: {
            items: await this.financeFacade.getBudgetStatus(ctx.userId),
          },
        };
      case 'create_or_update_budget': {
        const budget = args as ValidatedToolArgs<'create_or_update_budget'>;
        if (budget.budgetId) {
          return {
            success: true,
            message: 'Budget updated',
            data: await this.financeFacade.updateBudget(
              ctx.userId,
              budget.budgetId,
              {
                categoryId: budget.categoryId,
                periodType: budget.periodType,
                periodStart: budget.periodStart,
                periodEnd: budget.periodEnd,
                amountLimit: budget.amountLimit,
                alertThresholdPct: budget.alertThresholdPct ?? undefined,
              },
            ),
          };
        }
        return {
          success: true,
          message: 'Budget created',
          data: await this.financeFacade.createBudget(ctx.userId, {
            categoryId: budget.categoryId as string,
            periodType: budget.periodType as 'MONTHLY' | 'BIWEEKLY' | 'CUSTOM',
            periodStart: budget.periodStart as string,
            periodEnd: budget.periodEnd as string,
            amountLimit: budget.amountLimit as number,
            alertThresholdPct: budget.alertThresholdPct ?? undefined,
          }),
        };
      }
      case 'list_savings_goals':
        return {
          success: true,
          message: 'Savings goals loaded',
          data: {
            items: await this.financeFacade.listSavingsGoals(ctx.userId),
          },
        };
      case 'create_savings_goal': {
        const goal = args as ValidatedToolArgs<'create_savings_goal'>;
        return {
          success: true,
          message: 'Savings goal created',
          data: await this.financeFacade.createSavingsGoal(ctx.userId, {
            name: goal.name,
            targetAmount: goal.targetAmount,
            currentAmount: goal.currentAmount ?? undefined,
            currency: goal.currency ?? undefined,
            targetDate: goal.targetDate ?? undefined,
          }),
        };
      }
      case 'update_savings_goal': {
        const goal = args as ValidatedToolArgs<'update_savings_goal'>;
        return {
          success: true,
          message: 'Savings goal updated',
          data: await this.financeFacade.updateSavingsGoal(
            ctx.userId,
            goal.goalId,
            {
              currentAmount: goal.currentAmount ?? undefined,
              targetAmount: goal.targetAmount ?? undefined,
              name: goal.name ?? undefined,
            },
          ),
        };
      }
      case 'list_loans':
        return {
          success: true,
          message: 'Loans loaded',
          data: { items: await this.financeFacade.listLoans(ctx.userId) },
        };
      case 'mark_loan_installment_paid': {
        const loanArgs =
          args as ValidatedToolArgs<'mark_loan_installment_paid'>;
        const loans = await this.financeFacade.listLoans(ctx.userId);
        const loan = loans.find((item) => item.id === loanArgs.loanId);
        if (!loan) {
          return { success: false, message: 'Loan not found' };
        }
        return {
          success: true,
          message: 'Loan installment marked as paid',
          data: await this.financeFacade.updateLoan(
            ctx.userId,
            loanArgs.loanId,
            {
              paidInstallments: loan.paidInstallments + 1,
              currentBalance:
                Number(loan.currentBalance) - Number(loan.installmentAmount),
            },
          ),
        };
      }
      case 'trigger_email_sync': {
        const sync = args as ValidatedToolArgs<'trigger_email_sync'>;
        const result = await this.financeFacade.triggerEmailSync(
          ctx.userId,
          sync.sourceId,
          sync.forceFullSync ?? false,
        );
        return {
          success: result.queued === true,
          message: result.queued
            ? 'Email sync queued'
            : (result.reason ?? 'Email sync not queued'),
          data: result,
        };
      }
      case 'get_spending_by_category':
        return {
          success: true,
          message: 'Spending breakdown loaded',
          data: {
            items: await this.financeFacade.getSpendingByCategory(
              ctx.userId,
              typeof args.dateFrom === 'string' ? args.dateFrom : undefined,
              typeof args.dateTo === 'string' ? args.dateTo : undefined,
            ),
          },
        };
      case 'get_spending_over_time': {
        const groupBy =
          args.groupBy === 'week' || args.groupBy === 'month'
            ? args.groupBy
            : 'day';
        return {
          success: true,
          message: 'Spending over time loaded',
          data: await this.financeFacade.getSpendingOverTime(
            ctx.userId,
            typeof args.dateFrom === 'string' ? args.dateFrom : undefined,
            typeof args.dateTo === 'string' ? args.dateTo : undefined,
            groupBy,
          ),
        };
      }
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

/** Re-export for tests. */
export type { MutatingToolName };
