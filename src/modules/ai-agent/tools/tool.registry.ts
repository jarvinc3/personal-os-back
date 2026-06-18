import {
  getAllowedToolsForModule,
  MODULE_CONTEXT_SLUGS,
  MODULE_CONTEXT_SWITCH_TOOL,
} from '../prompts/module-context';
import type { AiToolDefinition } from '../utils/ai.types';

const ALL_TOOLS: AiToolDefinition[] = [
  {
    name: MODULE_CONTEXT_SWITCH_TOOL,
    description:
      'Switch the active chat module context for this session (e.g. general → finance) so module-specific tools become available. Call before finance or other module actions when the current context does not include those tools.',
    mutating: false,
    targetModule: 'core',
    parameters: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          enum: [...MODULE_CONTEXT_SLUGS],
          description: 'Target module context slug',
        },
      },
      required: ['slug'],
    },
  },
  {
    name: 'get_user_context',
    description:
      'Read the current user account (name, email, avatar, locale, timezone), preferences, and enabled modules.',
    mutating: false,
    targetModule: 'core',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'update_user_profile',
    description:
      'Update user account fields in the users table: display name, avatar URL, locale, or timezone. Email cannot be changed via this tool.',
    mutating: true,
    targetModule: 'core',
    parameters: {
      type: 'object',
      properties: {
        fullName: {
          type: 'string',
          description: 'Display name (max 120 chars)',
        },
        avatarUrl: {
          type: 'string',
          nullable: true,
          description: 'HTTPS URL for profile image, or null to remove avatar',
        },
        locale: {
          type: 'string',
          description: 'BCP 47 locale, e.g. es-DO, en-US',
        },
        timezone: {
          type: 'string',
          description: 'IANA timezone, e.g. America/Santo_Domingo',
        },
      },
    },
  },
  {
    name: 'set_theme',
    description: 'Set the app theme to system, light, or dark.',
    mutating: true,
    targetModule: 'core',
    parameters: {
      type: 'object',
      properties: {
        value: { type: 'string', enum: ['system', 'light', 'dark'] },
      },
      required: ['value'],
    },
  },
  {
    name: 'update_preferences',
    description: 'Partial update of user preferences object.',
    mutating: true,
    targetModule: 'core',
    parameters: {
      type: 'object',
      properties: {
        preferences: { type: 'object' },
      },
      required: ['preferences'],
    },
  },
  {
    name: 'update_ai_settings',
    description:
      'Update AI assistant settings (tone, defaultProvider, proactiveInsights, confirmBeforeActions).',
    mutating: true,
    targetModule: 'core',
    parameters: {
      type: 'object',
      properties: {
        tone: { type: 'string', enum: ['concise', 'balanced', 'detailed'] },
        defaultProvider: { type: 'string', nullable: true },
        proactiveInsights: { type: 'boolean' },
        confirmBeforeActions: { type: 'boolean' },
      },
    },
  },
  {
    name: 'update_notification_settings',
    description: 'Update notification channels or quiet hours.',
    mutating: true,
    targetModule: 'core',
    parameters: {
      type: 'object',
      properties: {
        channels: {
          type: 'object',
          properties: {
            push: { type: 'boolean' },
            email: { type: 'boolean' },
            inApp: { type: 'boolean' },
          },
        },
        quietHours: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            start: { type: 'string' },
            end: { type: 'string' },
          },
        },
      },
    },
  },
  {
    name: 'update_module_config',
    description:
      'Update configuration for a module (agenda, projects, health, subscriptions).',
    mutating: true,
    targetModule: 'modules',
    parameters: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          enum: ['agenda', 'projects', 'health', 'subscriptions'],
        },
        config: { type: 'object' },
      },
      required: ['slug', 'config'],
    },
  },
  {
    name: 'toggle_module',
    description: 'Enable or disable a module.',
    mutating: true,
    targetModule: 'modules',
    parameters: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          enum: ['agenda', 'projects', 'health', 'subscriptions'],
        },
        isEnabled: { type: 'boolean' },
      },
      required: ['slug', 'isEnabled'],
    },
  },
  {
    name: 'get_finance_summary',
    description: 'Get finance summary including net worth and cash flow.',
    mutating: false,
    targetModule: 'finance',
    parameters: {
      type: 'object',
      properties: {
        dateFrom: { type: 'string' },
        dateTo: { type: 'string' },
      },
    },
  },
  {
    name: 'list_transactions',
    description: 'List finance transactions with optional filters.',
    mutating: false,
    targetModule: 'finance',
    parameters: {
      type: 'object',
      properties: {
        accountId: { type: 'string' },
        cardId: { type: 'string' },
        categoryId: { type: 'string' },
        type: { type: 'string', enum: ['DEBIT', 'CREDIT', 'TRANSFER'] },
        status: { type: 'string', enum: ['PENDING', 'CONFIRMED', 'CANCELLED'] },
        dateFrom: { type: 'string' },
        dateTo: { type: 'string' },
        search: { type: 'string' },
      },
    },
  },
  {
    name: 'create_transaction',
    description: 'Create a new finance transaction.',
    mutating: true,
    targetModule: 'finance',
    parameters: {
      type: 'object',
      properties: {
        accountId: { type: 'string', nullable: true },
        cardId: { type: 'string', nullable: true },
        type: { type: 'string', enum: ['DEBIT', 'CREDIT', 'TRANSFER'] },
        amount: { type: 'number' },
        currency: { type: 'string' },
        transactionDate: { type: 'string' },
        description: { type: 'string', nullable: true },
        merchant: { type: 'string', nullable: true },
        categoryId: { type: 'string', nullable: true },
      },
      required: ['type', 'amount', 'transactionDate'],
    },
  },
  {
    name: 'get_budget_status',
    description: 'Get budget usage and threshold status.',
    mutating: false,
    targetModule: 'finance',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'create_or_update_budget',
    description: 'Create or update a budget period.',
    mutating: true,
    targetModule: 'finance',
    parameters: {
      type: 'object',
      properties: {
        budgetId: { type: 'string', nullable: true },
        categoryId: { type: 'string' },
        periodType: { type: 'string', enum: ['MONTHLY', 'BIWEEKLY', 'CUSTOM'] },
        periodStart: { type: 'string' },
        periodEnd: { type: 'string' },
        amountLimit: { type: 'number' },
        alertThresholdPct: { type: 'number', nullable: true },
      },
      required: ['categoryId', 'periodType', 'periodStart', 'periodEnd', 'amountLimit'],
    },
  },
  {
    name: 'list_savings_goals',
    description: 'List savings goals.',
    mutating: false,
    targetModule: 'finance',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'create_savings_goal',
    description: 'Create a savings goal.',
    mutating: true,
    targetModule: 'finance',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        targetAmount: { type: 'number' },
        currentAmount: { type: 'number', nullable: true },
        currency: { type: 'string', nullable: true },
        targetDate: { type: 'string', nullable: true },
      },
      required: ['name', 'targetAmount'],
    },
  },
  {
    name: 'update_savings_goal',
    description: 'Update savings goal progress or details.',
    mutating: true,
    targetModule: 'finance',
    parameters: {
      type: 'object',
      properties: {
        goalId: { type: 'string' },
        currentAmount: { type: 'number', nullable: true },
        targetAmount: { type: 'number', nullable: true },
        name: { type: 'string', nullable: true },
      },
      required: ['goalId'],
    },
  },
  {
    name: 'list_loans',
    description: 'List active loans.',
    mutating: false,
    targetModule: 'finance',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'mark_loan_installment_paid',
    description: 'Mark one loan installment as paid.',
    mutating: true,
    targetModule: 'finance',
    parameters: {
      type: 'object',
      properties: {
        loanId: { type: 'string' },
      },
      required: ['loanId'],
    },
  },
  {
    name: 'trigger_email_sync',
    description: 'Trigger Gmail sync for one source.',
    mutating: true,
    targetModule: 'finance',
    parameters: {
      type: 'object',
      properties: {
        sourceId: { type: 'string' },
      },
      required: ['sourceId'],
    },
  },
  {
    name: 'get_spending_by_category',
    description: 'Get spending breakdown by category.',
    mutating: false,
    targetModule: 'finance',
    parameters: {
      type: 'object',
      properties: {
        dateFrom: { type: 'string' },
        dateTo: { type: 'string' },
      },
    },
  },
];

export function getToolsForModule(
  moduleSlug: string | null,
): AiToolDefinition[] {
  const allowed = new Set(getAllowedToolsForModule(moduleSlug));
  return ALL_TOOLS.filter((t) => allowed.has(t.name));
}

export function getToolDefinition(name: string): AiToolDefinition | undefined {
  return ALL_TOOLS.find((t) => t.name === name);
}

function payloadString(value: unknown, fallback = '?'): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return fallback;
}

export function getActionLabel(
  actionType: string,
  payload: Record<string, unknown>,
): string {
  switch (actionType) {
    case 'set_theme':
      return `Cambiar tema a ${payloadString(payload.value)}`;
    case 'update_ai_settings':
      return 'Actualizar configuración del asistente IA';
    case 'update_notification_settings':
      return 'Actualizar preferencias de notificaciones';
    case 'update_module_config':
      return `Actualizar configuración de ${payloadString(payload.slug, 'módulo')}`;
    case 'toggle_module':
      return `${payload.isEnabled === true ? 'Activar' : 'Desactivar'} módulo ${payloadString(payload.slug, '')}`;
    case 'update_preferences':
      return 'Actualizar preferencias';
    case MODULE_CONTEXT_SWITCH_TOOL:
      return `Cambiar contexto a ${payloadString(payload.slug)}`;
    case 'get_finance_summary':
      return 'Ver resumen financiero';
    case 'list_transactions':
      return 'Consultar transacciones';
    case 'create_transaction':
      return 'Crear transacción';
    case 'get_budget_status':
      return 'Revisar estado de presupuestos';
    case 'create_or_update_budget':
      return 'Crear o actualizar presupuesto';
    case 'list_savings_goals':
      return 'Consultar metas de ahorro';
    case 'create_savings_goal':
      return 'Crear meta de ahorro';
    case 'update_savings_goal':
      return 'Actualizar meta de ahorro';
    case 'list_loans':
      return 'Consultar préstamos';
    case 'mark_loan_installment_paid':
      return 'Marcar cuota de préstamo pagada';
    case 'trigger_email_sync':
      return 'Sincronizar correos bancarios';
    case 'get_spending_by_category':
      return 'Analizar gastos por categoría';
    case 'update_user_profile':
      if (typeof payload.fullName === 'string' && payload.fullName) {
        return `Actualizar nombre a "${payload.fullName}"`;
      }
      if (payload.avatarUrl === null) {
        return 'Quitar foto de perfil';
      }
      if (payload.avatarUrl) {
        return 'Actualizar foto de perfil';
      }
      if (typeof payload.locale === 'string' && payload.locale) {
        return `Cambiar idioma/región a ${payload.locale}`;
      }
      if (typeof payload.timezone === 'string' && payload.timezone) {
        return `Cambiar zona horaria a ${payload.timezone}`;
      }
      return 'Actualizar perfil de usuario';
    default:
      return actionType;
  }
}

export function toolsToOpenAiFormat(tools: AiToolDefinition[]) {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

export function parseToolCallArguments(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}
