export { UsersService } from './application/users.service';
export { WipeUserDataUseCase } from './application/wipe-user-data.use-case';
export {
  USER_DATA_WIPE_DOMAINS,
  type UserDataWipeDomainsPort,
} from './application/ports/user-data-wipe-domains.port';
export {
  GLOBAL_USER_PREFERENCES_DEFAULTS,
  type AiTone,
  type ParsedUserPreferences,
} from './domain/defaults/global-preferences-defaults';
export { parseUserPreferences } from './domain/parse-user-preferences';
export {
  DATA_APP,
  expandDataBranches,
  groupDataBranchCounts,
  isKnownDataBranch,
  type DataApp,
  type DataAppBranches,
  type DataBranchCount,
  type DataBranchDescriptor,
} from './domain/data-branches';
export {
  SETTINGS_DATA_BRANCHES,
  SETTINGS_DEFAULTS_BRANCH,
} from './domain/settings-data-branches';
export { mergeWithDefaults } from './domain/settings-merge';
export {
  USERS_REPOSITORY,
  type AuthDeletionClaim,
  type ModuleConfigRow,
  type ModuleRecord,
  type ModuleSettingsDefaults,
  type UpdateProfileData,
  type UserModuleConfigRow,
  type UserModuleRecord,
  type UserWithModulesRecord,
  type UsersRepositoryPort,
} from './application/ports/users.repository.port';
export { UsersModule } from './users.module';
