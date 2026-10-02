export { UsersService } from './application/users.service';
export {
  GLOBAL_USER_PREFERENCES_DEFAULTS,
  type AiTone,
  type ParsedUserPreferences,
} from './domain/defaults/global-preferences-defaults';
export {
  DEFAULT_MODULE_CONFIG_BY_SLUG,
  FINANCE_NOTIFICATION_KEYS,
  isModuleSlug,
  MODULE_SLUGS,
  type FinanceNotificationKey,
  type ModuleSlug,
} from './domain/defaults/user-settings-defaults';
export { parseUserPreferences } from './domain/parse-user-preferences';
export {
  DEFAULT_EMAIL_SYNC_SCHEDULE,
  EMAIL_SYNC_SCHEDULE_MODES,
  MAX_EMAIL_SYNC_TIMES,
  MIN_EMAIL_SYNC_INTERVAL_MINUTES,
  parseEmailSyncSchedule,
  validateEmailSyncSchedule,
  type EmailSyncSchedule,
  type EmailSyncScheduleMode,
} from './domain/email-sync-schedule';
export { mergeWithDefaults } from './domain/settings-merge';
export { UsersRepository } from './infrastructure/users.repository';
export { UsersModule } from './users.module';
