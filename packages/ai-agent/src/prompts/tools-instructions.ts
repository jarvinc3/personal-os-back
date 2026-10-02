import { getToolDefinition } from '../tools/tool.registry';
import { getAllowedToolsForModule } from './module-context';

export function getToolsListForModule(moduleSlug: string | null): string {
  const allowed = getAllowedToolsForModule(moduleSlug);
  const lines = allowed.map((name) => {
    const def = getToolDefinition(name);
    return def
      ? `- ${name}: ${def.description}`
      : `- ${name}`;
  });
  return `Available tools for this context:\n${lines.join('\n')}`;
}

export function getToolsBehaviorInstructions(confirmBeforeActions: boolean): string {
  if (confirmBeforeActions) {
    return `Mutating tools create a confirmation card in the UI. Always call the tool first, then briefly explain what the user should confirm in the card. Never ask for confirmation only in text without calling the tool.

For direct requests like "cambia el tema a light" or "activa notificaciones de email", call the matching tool in the same turn.

When the user needs another module's data or actions (e.g. finances while in General), call switch_module_context with the target slug first, then call that module's tools in the same turn.`;
  }

  return `confirm-before-actions is OFF. Execute mutating tools immediately when the user asks — do NOT ask "¿quieres confirmar?" or similar. Never claim you performed an action without calling the tool.

For direct requests like "cambia el tema a light" or "activa notificaciones de email", call set_theme or update_notification_settings immediately in the same turn.

When the user needs another module, call switch_module_context first, then execute that module's tools without asking the user to change the selector manually.`;
}
