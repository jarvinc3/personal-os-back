export const MODULE_CONTEXT: Record<
  string,
  { label: string; description: string; allowedTools: string[] }
> = {
  general: {
    label: 'General',
    description: 'Cross-app assistant for preferences, theme, notifications, and module management.',
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
    description: 'Calendar and scheduling module. Help configure agenda settings and reminders.',
    allowedTools: [
      'get_user_context',
      'update_module_config',
      'toggle_module',
      'update_notification_settings',
    ],
  },
  projects: {
    label: 'Projects',
    description: 'Project management module. Help configure project tracking settings.',
    allowedTools: [
      'get_user_context',
      'update_module_config',
      'toggle_module',
    ],
  },
  health: {
    label: 'Health',
    description: 'Health tracking module. Help configure health-related settings.',
    allowedTools: [
      'get_user_context',
      'update_module_config',
      'toggle_module',
    ],
  },
  subscriptions: {
    label: 'Subscriptions',
    description: 'Subscription tracking module. Help configure subscription alerts.',
    allowedTools: [
      'get_user_context',
      'update_module_config',
      'toggle_module',
      'update_notification_settings',
    ],
  },
  finance: {
    label: 'Finanzas',
    description:
      'Personal finance module. Analyze spending, budgets, goals, loans, and trigger finance actions.',
    allowedTools: [
      'get_user_context',
      'get_finance_summary',
      'list_transactions',
      'create_transaction',
      'get_budget_status',
      'create_or_update_budget',
      'list_savings_goals',
      'update_savings_goal',
      'create_savings_goal',
      'list_loans',
      'mark_loan_installment_paid',
      'trigger_email_sync',
      'get_spending_by_category',
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
  return MODULE_CONTEXT[key].allowedTools;
}
