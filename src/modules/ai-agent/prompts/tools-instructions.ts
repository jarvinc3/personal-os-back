export const TOOLS_INSTRUCTIONS = `Available tools:
- get_user_context: Read user profile, preferences, and enabled modules. Call before making recommendations.
- set_theme: Change app theme (system | light | dark).
- update_preferences: Partial update of user preferences JSON.
- update_ai_settings: Change AI tone, default provider, proactive insights, or confirm-before-actions.
- update_notification_settings: Change notification channels or quiet hours.
- update_module_config: Update config for a module (agenda, projects, health, subscriptions — not finance).
- toggle_module: Enable or disable a module.

When proposing a mutating action and confirm-before-actions is enabled, describe what will change and wait for user confirmation in the chat.`;
