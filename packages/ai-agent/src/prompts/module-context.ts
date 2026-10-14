export const MODULE_CONTEXT_SWITCH_TOOL = 'switch_module_context';

export const MODULE_CONTEXT_SLUGS = [
  'general',
  'agenda',
  'projects',
  'health',
  'finance',
] as const;

export type ModuleContextSlug = (typeof MODULE_CONTEXT_SLUGS)[number];

export const MODULE_CONTEXT: Record<
  string,
  { label: string; description: string; allowedTools: string[] }
> = {
  general: {
    label: 'General',
    description:
      'Cross-app assistant for preferences, theme, notifications, and module management. For other modules (e.g. Finanzas), call switch_module_context before using their tools.',
    allowedTools: [
      'get_user_context',
      'update_user_profile',
      'update_preferences',
      'set_theme',
      'update_ai_settings',
      'update_notification_settings',
      'update_module_config',
      'toggle_module',
    ],
  },
  agenda: {
    label: 'Agenda',
    description:
      'Calendar and scheduling module. Help configure agenda settings and reminders.',
    allowedTools: [
      'get_user_context',
      'update_module_config',
      'toggle_module',
      'update_notification_settings',
    ],
  },
  projects: {
    label: 'Projects',
    description:
      'Project management module. Help configure project tracking settings.',
    allowedTools: ['get_user_context', 'update_module_config', 'toggle_module'],
  },
  health: {
    label: 'Health',
    description:
      'Health tracking module. Help configure health-related settings.',
    allowedTools: ['get_user_context', 'update_module_config', 'toggle_module'],
  },
  finance: {
    label: 'Finanzas',
    description:
      'Personal finance module. Analyze spending, budgets, goals, loans, and trigger finance actions. When the user describes a new loan in words (monto, plazo, tasa or cuota, prestamista), answer with a markdown link to `/finance/loans/new` carrying the values as query params (`amount`, `periods`, `ratePercent` or `installment`, `lenderName`) so the wizard opens prefilled and the user only confirms.',
    allowedTools: [
      'get_user_context',
      'get_finance_summary',
      'list_transactions',
      'get_transaction',
      'list_accounts',
      'list_cards',
      'list_categories',
      'list_email_sources',
      'list_budgets',
      'create_transaction',
      'update_transaction',
      'confirm_transaction',
      'unconfirm_transaction',
      'create_transfer',
      'get_budget_status',
      'create_or_update_budget',
      'list_savings_goals',
      'update_savings_goal',
      'create_savings_goal',
      'record_savings_contribution',
      'list_loans',
      'mark_loan_installment_paid',
      'trigger_email_sync',
      'adjust_balance',
      'link_transaction',
      'list_pending_emails',
      'assign_pending_email',
      'retry_pending_email',
      'complete_pending_email_amount',
      'get_spending_by_category',
      'get_spending_over_time',
      'list_subscriptions',
      'confirm_recurring',
      'list_merchants',
      'create_subscription',
      'confirm_subscription_payment',
    ],
  },
};

export function getModuleContextPrompt(moduleSlug: string | null): string {
  const key = moduleSlug && MODULE_CONTEXT[moduleSlug] ? moduleSlug : 'general';
  const ctx = MODULE_CONTEXT[key];
  return `Active module context: ${ctx.label}. ${ctx.description}`;
}

export function getAllowedToolsForModule(moduleSlug: string | null): string[] {
  const key = moduleSlug && MODULE_CONTEXT[moduleSlug] ? moduleSlug : 'general';
  const tools = [...MODULE_CONTEXT[key].allowedTools];
  if (!tools.includes(MODULE_CONTEXT_SWITCH_TOOL)) {
    tools.push(MODULE_CONTEXT_SWITCH_TOOL);
  }
  return tools;
}

export function resolveModuleContextKey(
  moduleSlug: string | null,
): ModuleContextSlug {
  if (moduleSlug && MODULE_CONTEXT[moduleSlug]) {
    return moduleSlug as ModuleContextSlug;
  }
  return 'general';
}

export function getModuleContextLabel(moduleSlug: string | null): string {
  return MODULE_CONTEXT[resolveModuleContextKey(moduleSlug)].label;
}
