# Core AI Tools (general context)

Available when `moduleSlug` is `general` or unset. Source: `MODULE_CONTEXT.general`.

## Read-only tools

### `get_user_context`

Returns the authenticated user profile, merged preferences, and enabled modules.

| Parameter | Type | Required | Description                      |
| --------- | ---- | -------- | -------------------------------- |
| _(none)_  | —    | —        | Uses JWT `sub` from tool context |

**Delegates to:** `UsersService.findById`

**Response data:** `{ profile: { id, email, fullName, avatarUrl, locale, timezone, preferences, userModules } }`

---

## Mutating tools

### `update_user_profile`

Updates account fields in the `users` table. Email is read-only.

| Parameter   | Type           | Required | Description                        |
| ----------- | -------------- | -------- | ---------------------------------- |
| `fullName`  | string         | no       | Display name (max 120 chars)       |
| `avatarUrl` | string \| null | no       | HTTPS URL or `null` to remove      |
| `locale`    | string         | no       | BCP 47, e.g. `es-DO`               |
| `timezone`  | string         | no       | IANA, e.g. `America/Santo_Domingo` |

At least one field must be provided.

**Side effects:** invalidates `profile`, `me`

---

### `set_theme`

Sets the app color theme.

| Parameter | Type   | Required | Values                    |
| --------- | ------ | -------- | ------------------------- |
| `value`   | string | yes      | `system`, `light`, `dark` |

**Side effects:** invalidates `profile`, `me`; emits `{ type: 'theme', value }`

---

### `update_preferences`

Partial merge into the user `preferences` JSONB column.

| Parameter     | Type   | Required | Description                |
| ------------- | ------ | -------- | -------------------------- |
| `preferences` | object | yes      | Partial preferences object |

**Side effects:** invalidates `profile`, `me`

---

### `update_ai_settings`

Updates AI assistant preferences.

| Parameter              | Type           | Required | Description                                |
| ---------------------- | -------------- | -------- | ------------------------------------------ |
| `tone`                 | string         | no       | `concise`, `balanced`, `detailed`          |
| `defaultProvider`      | string \| null | no       | Provider slug or null                      |
| `proactiveInsights`    | boolean        | no       | Enable proactive insights                  |
| `confirmBeforeActions` | boolean        | no       | Require UI confirmation for mutating tools |

**Side effects:** invalidates `profile`, `me`

---

### `update_notification_settings`

Updates notification channel toggles and quiet hours.

| Parameter    | Type   | Required | Description                          |
| ------------ | ------ | -------- | ------------------------------------ |
| `channels`   | object | no       | `{ push?, email?, inApp? }` booleans |
| `quietHours` | object | no       | `{ enabled?, start?, end? }`         |

**Side effects:** invalidates `profile`, `me`

---

### `update_module_config`

Updates per-module JSON config for non-finance modules.

| Parameter | Type   | Required | Description                                     |
| --------- | ------ | -------- | ----------------------------------------------- |
| `slug`    | string | yes      | `agenda`, `projects`, `health`, `subscriptions` |
| `config`  | object | yes      | Module-specific config patch                    |

**Note:** `finance` slug is rejected — finance config is not editable via chat.

**Side effects:** invalidates `profile`, `me`, `user-module:{slug}`

---

### `toggle_module`

Enables or disables a module for the current user.

| Parameter   | Type    | Required | Description                                     |
| ----------- | ------- | -------- | ----------------------------------------------- |
| `slug`      | string  | yes      | `agenda`, `projects`, `health`, `subscriptions` |
| `isEnabled` | boolean | yes      | Target enabled state                            |

**Side effects:** invalidates `profile`, `me`

## Notes

- All mutating tools respect `confirmBeforeActions` in user AI settings.
- `targetModule` for core tools is `core` except module helpers (`modules`).
- These tools are also included as read-only `get_user_context` in other module contexts where listed in `MODULE_CONTEXT`.
