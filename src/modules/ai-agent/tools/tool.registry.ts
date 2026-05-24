import type { AiToolDefinition } from '../utils/ai.types';
import { getAllowedToolsForModule } from '../prompts/module-context';

const ALL_TOOLS: AiToolDefinition[] = [
  {
    name: 'get_user_context',
    description: 'Read the current user profile, preferences, and enabled modules.',
    mutating: false,
    targetModule: 'core',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
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
        defaultProvider: { type: ['string', 'null'] },
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
];

export function getToolsForModule(moduleSlug: string | null): AiToolDefinition[] {
  const allowed = new Set(getAllowedToolsForModule(moduleSlug));
  return ALL_TOOLS.filter((t) => allowed.has(t.name));
}

export function getToolDefinition(name: string): AiToolDefinition | undefined {
  return ALL_TOOLS.find((t) => t.name === name);
}

export function getActionLabel(
  actionType: string,
  payload: Record<string, unknown>,
): string {
  switch (actionType) {
    case 'set_theme':
      return `Cambiar tema a ${payload.value ?? '?'}`;
    case 'update_ai_settings':
      return 'Actualizar configuración del asistente IA';
    case 'update_notification_settings':
      return 'Actualizar preferencias de notificaciones';
    case 'update_module_config':
      return `Actualizar configuración de ${payload.slug ?? 'módulo'}`;
    case 'toggle_module':
      return `${payload.isEnabled ? 'Activar' : 'Desactivar'} módulo ${payload.slug ?? ''}`;
    case 'update_preferences':
      return 'Actualizar preferencias';
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
