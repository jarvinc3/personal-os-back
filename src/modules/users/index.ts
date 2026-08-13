export { UsersService } from './application/users.service';
export {
    GLOBAL_USER_PREFERENCES_DEFAULTS,
    type AiTone,
    type ParsedUserPreferences
} from './domain/defaults/global-preferences-defaults';
export {
    DEFAULT_MODULE_CONFIG_BY_SLUG, FINANCE_NOTIFICATION_KEYS, isModuleSlug, MODULE_SLUGS, type FinanceNotificationKey, type ModuleSlug
} from './domain/defaults/user-settings-defaults';
export { parseUserPreferences } from './domain/parse-user-preferences';
export { mergeWithDefaults } from './domain/settings-merge';
export { UsersRepository } from './infrastructure/users.repository';
export { UsersModule } from './users.module';

