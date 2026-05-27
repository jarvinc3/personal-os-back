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
