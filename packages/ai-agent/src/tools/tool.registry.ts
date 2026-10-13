import {
  getAllowedToolsForModule,
  MODULE_CONTEXT_SLUGS,
  MODULE_CONTEXT_SWITCH_TOOL,
} from '../prompts/module-context';
import type { AiToolDefinition } from '../shared/ai.types';
import {
  isMutatingToolName,
  MUTATING_TOOL_ARG_SCHEMAS,
  mutatingToolParametersJsonSchema,
  type MutatingToolName,
} from './tool-arg-schemas';

type StaticToolDef = Omit<AiToolDefinition, 'parameters'> & {
  /** Only non-mutating tools keep hand-written parameters. */
  parameters?: Record<string, unknown>;
};

const STATIC_TOOLS: StaticToolDef[] = [
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
  },
  {
    name: 'set_theme',
    description: 'Set the app theme to system, light, or dark.',
    mutating: true,
    targetModule: 'core',
  },
  {
    name: 'update_preferences',
    description: 'Partial update of user preferences object.',
    mutating: true,
    targetModule: 'core',
  },
  {
    name: 'update_ai_settings',
    description:
      'Update AI assistant settings (tone, defaultProvider, proactiveInsights, confirmBeforeActions).',
    mutating: true,
    targetModule: 'core',
  },
  {
    name: 'update_notification_settings',
    description: 'Update notification channels or quiet hours.',
    mutating: true,
    targetModule: 'core',
  },
  {
    name: 'update_module_config',
    description:
      'Update configuration for a module (agenda, projects, health, subscriptions).',
    mutating: true,
    targetModule: 'modules',
  },
  {
    name: 'toggle_module',
    description: 'Enable or disable a module.',
    mutating: true,
    targetModule: 'modules',
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
        type: {
          type: 'string',
          enum: ['DEBIT', 'CREDIT', 'TRANSFER', 'ADJUSTMENT'],
        },
        status: {
          type: 'string',
          enum: ['PENDING', 'CONFIRMED', 'CANCELLED', 'DECLINED', 'REVERSED'],
        },
        dateFrom: { type: 'string' },
        dateTo: { type: 'string' },
        search: { type: 'string' },
      },
    },
  },
  {
    name: 'get_transaction',
    description: 'Get one finance transaction by id.',
    mutating: false,
    targetModule: 'finance',
    parameters: {
      type: 'object',
      properties: {
        transactionId: { type: 'string' },
      },
      required: ['transactionId'],
    },
  },
  {
    name: 'list_categories',
    description:
      'List finance categories (system + user). Filter by type EXPENSE or INCOME.',
    mutating: false,
    targetModule: 'finance',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['EXPENSE', 'INCOME'] },
      },
    },
  },
  {
    name: 'list_accounts',
    description: 'List finance accounts (checking, savings, cash, investment).',
    mutating: false,
    targetModule: 'finance',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'list_cards',
    description: 'List credit/debit cards and multi-currency balances.',
    mutating: false,
    targetModule: 'finance',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'list_budgets',
    description: 'List budget periods for the user.',
    mutating: false,
    targetModule: 'finance',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'list_email_sources',
    description: 'List connected Gmail bank email sources.',
    mutating: false,
    targetModule: 'finance',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'create_transaction',
    description: 'Create a new finance transaction.',
    mutating: true,
    targetModule: 'finance',
  },
  {
    name: 'create_transfer',
    description:
      'Transfer money from an account to another account. Card payments use pay_card.',
    mutating: true,
    targetModule: 'finance',
  },
  {
    name: 'pay_card',
    description: 'Pay a credit card from an account.',
    mutating: true,
    targetModule: 'finance',
  },
  {
    name: 'get_card_statement',
    description: 'Get a credit card statement with its status and amounts.',
    mutating: false,
    targetModule: 'finance',
  },
  {
    name: 'update_transaction',
    description:
      'Update transaction category/merchant/description/notes (especially for email imports).',
    mutating: true,
    targetModule: 'finance',
  },
  {
    name: 'confirm_transaction',
    description: 'Confirm a PENDING finance transaction (applies ledger).',
    mutating: true,
    targetModule: 'finance',
  },
  {
    name: 'unconfirm_transaction',
    description:
      'Move a CONFIRMED finance transaction back to PENDING so it can be edited.',
    mutating: true,
    targetModule: 'finance',
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
  },
  {
    name: 'update_savings_goal',
    description: 'Update savings goal details.',
    mutating: true,
    targetModule: 'finance',
  },
  {
    name: 'allocate_to_goal',
    description:
      'Set money aside for a savings goal, or withdraw it. It never moves money.',
    mutating: true,
    targetModule: 'finance',
  },
  {
    name: 'record_receivable_payment',
    description:
      'Record a payment collected for a receivable, resolving any excess.',
    mutating: true,
    targetModule: 'finance',
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
    description:
      'Pay the oldest unpaid loan installment with its capital/interest split.',
    mutating: true,
    targetModule: 'finance',
  },
  {
    name: 'prepay_loan',
    description:
      'Pay an extra amount to loan capital, reducing the term or the installment.',
    mutating: true,
    targetModule: 'finance',
  },
  {
    name: 'get_loan_schedule',
    description: 'Get the full loan installment schedule.',
    mutating: false,
    targetModule: 'finance',
  },
  {
    name: 'list_possible_duplicates',
    description: 'List movements flagged as possible duplicates.',
    mutating: false,
    targetModule: 'finance',
  },
  {
    name: 'trigger_email_sync',
    description: 'Trigger Gmail sync for one source.',
    mutating: true,
    targetModule: 'finance',
  },
  {
    name: 'adjust_balance',
    description:
      'Set an account or card balance by posting an adjustment movement.',
    mutating: true,
    targetModule: 'finance',
  },
  {
    name: 'link_transaction',
    description:
      'Link an existing movement to a loan instalment, a collection or a savings goal. It never creates a new movement.',
    mutating: true,
    targetModule: 'finance',
  },
  {
    name: 'list_pending_emails',
    description: 'List email imports waiting for an account, card or amount.',
    mutating: false,
    targetModule: 'finance',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'assign_pending_email',
    description:
      'Assign a pending email import to an account or card, optionally with its amount.',
    mutating: true,
    targetModule: 'finance',
  },
  {
    name: 'retry_pending_email',
    description: 'Retry automatic routing for a pending email import.',
    mutating: true,
    targetModule: 'finance',
  },
  {
    name: 'complete_pending_email_amount',
    description:
      'Complete a pending email import that arrived without an amount.',
    mutating: true,
    targetModule: 'finance',
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
  {
    name: 'get_spending_over_time',
    description: 'Get income/expense totals bucketed by day, week, or month.',
    mutating: false,
    targetModule: 'finance',
    parameters: {
      type: 'object',
      properties: {
        dateFrom: { type: 'string' },
        dateTo: { type: 'string' },
        groupBy: {
          type: 'string',
          enum: ['day', 'week', 'month'],
        },
      },
    },
  },
];

function resolveParameters(tool: StaticToolDef): Record<string, unknown> {
  if (tool.mutating && isMutatingToolName(tool.name)) {
    return mutatingToolParametersJsonSchema(tool.name);
  }
  return tool.parameters ?? { type: 'object', properties: {} };
}

const ALL_TOOLS: AiToolDefinition[] = STATIC_TOOLS.map((tool) => ({
  name: tool.name,
  description: tool.description,
  mutating: tool.mutating,
  targetModule: tool.targetModule,
  parameters: resolveParameters(tool),
}));

/** Ensures every mutating schema is registered as a tool definition. */
void (Object.keys(MUTATING_TOOL_ARG_SCHEMAS) as MutatingToolName[]).forEach(
  (name) => {
    if (!ALL_TOOLS.some((t) => t.name === name && t.mutating)) {
      throw new Error(`Missing tool definition for mutating schema: ${name}`);
    }
  },
);

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
  if (typeof value === 'string') {
    return value;
  }
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
    case 'get_user_context':
      return 'Consultar contexto del usuario';
    case 'list_transactions':
      return 'Consultar transacciones';
    case 'get_transaction':
      return 'Ver detalle de transacción';
    case 'list_categories':
      return 'Consultar categorías';
    case 'list_accounts':
      return 'Consultar cuentas';
    case 'list_cards':
      return 'Consultar tarjetas';
    case 'list_budgets':
      return 'Consultar presupuestos';
    case 'list_email_sources':
      return 'Consultar fuentes de correo';
    case 'create_transaction':
      return 'Crear transacción';
    case 'create_transfer':
      return 'Crear transferencia';
    case 'update_transaction':
      return 'Actualizar transacción';
    case 'confirm_transaction':
      return 'Confirmar transacción';
    case 'unconfirm_transaction':
      return 'Desbloquear transacción';
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
    case 'allocate_to_goal':
      return 'Apartar en una meta de ahorro';
    case 'list_loans':
      return 'Consultar préstamos';
    case 'mark_loan_installment_paid':
      return 'Marcar cuota de préstamo pagada';
    case 'prepay_loan':
      return 'Abonar a capital del préstamo';
    case 'get_loan_schedule':
      return 'Consultar tabla del préstamo';
    case 'trigger_email_sync':
      return 'Sincronizar correos bancarios';
    case 'get_spending_by_category':
      return 'Analizar gastos por categoría';
    case 'get_spending_over_time':
      return 'Analizar gastos en el tiempo';
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

export type ParseToolCallArgumentsResult =
  { ok: true; args: Record<string, unknown> } | { ok: false; message: string };

/**
 * Fail-closed parse of provider tool-call JSON. Invalid or non-object payloads
 * are rejected so mutators never run on `{}` from a bad parse.
 */
export function parseToolCallArguments(raw: string): Record<string, unknown> {
  const result = parseToolCallArgumentsStrict(raw);
  // Providers historically received `{}`; callers that need fail-closed should use
  // parseToolCallArgumentsStrict. This wrapper stays for compatibility but returns
  // a marker so validation can still reject empty unknown shapes for mutators.
  if (!result.ok) {
    return { __parseError: result.message };
  }
  return result.args;
}

export function parseToolCallArgumentsStrict(
  raw: string,
): ParseToolCallArgumentsResult {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      return {
        ok: false,
        message: 'Tool arguments must be a JSON object',
      };
    }
    return { ok: true, args: parsed as Record<string, unknown> };
  } catch {
    return {
      ok: false,
      message: 'Tool arguments are not valid JSON',
    };
  }
}
