export const TOOLS_LIST = `Available tools:
- get_user_context: Read user profile, preferences, and enabled modules. Use for recommendations or when you need unknown preference values — NOT for simple theme or notification changes.
- set_theme: Change app theme (system | light | dark). Call immediately when the user asks to change theme.
- update_preferences: Partial update of user preferences JSON.
- update_ai_settings: Change AI tone, default provider, proactive insights, or confirm-before-actions.
- update_notification_settings: Change notification channels (push, email, inApp) or quiet hours.
- update_module_config: Update config for a module (agenda, projects, health, subscriptions — not finance).
- toggle_module: Enable or disable a module.`;

export function getToolsBehaviorInstructions(confirmBeforeActions: boolean): string {
  if (confirmBeforeActions) {
    return `Mutating tools create a confirmation card in the UI. Always call the tool first, then briefly explain what the user should confirm in the card. Never ask for confirmation only in text without calling the tool.

For direct requests like "cambia el tema a light" or "activa notificaciones de email", call the matching tool in the same turn.`;
  }

  return `confirm-before-actions is OFF. Execute mutating tools immediately when the user asks — do NOT ask "¿quieres confirmar?" or similar. Never claim you performed an action without calling the tool.

For direct requests like "cambia el tema a light" or "activa notificaciones de email", call set_theme or update_notification_settings immediately in the same turn.`;
}
