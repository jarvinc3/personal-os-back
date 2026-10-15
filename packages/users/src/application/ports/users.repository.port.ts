export const USERS_REPOSITORY = 'USERS_REPOSITORY' as const;

export type UserModuleConfigRow = {
  isEnabled: boolean;
  config: unknown;
  enabledAt: Date;
  module: { slug: string };
};

export type UserWithModulesRecord = {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  timezone: string;
  locale: string;
  preferences: unknown;
  userModules: UserModuleConfigRow[];
  createdAt: Date;
  updatedAt: Date;
};

export type ModuleRecord = {
  id: string;
  slug: string;
};

export type UserModuleRecord = {
  id: string;
  isEnabled: boolean;
  config: unknown;
};

export type FinanceSummaryRecipientRow = {
  userId: string;
  timezone: string;
  config: unknown;
};

export type UpdateProfileData = {
  fullName?: string;
  timezone?: string;
  locale?: string;
  avatarUrl?: string | null;
  preferences?: Record<string, unknown>;
};

export type AuthDeletionClaim = {
  id: string;
  userId: string;
  attempts: number;
};

export interface UsersRepositoryPort {
  findById(id: string): Promise<UserWithModulesRecord | null>;
  findModuleBySlug(slug: string): Promise<ModuleRecord | null>;
  findUserModule(
    userId: string,
    moduleId: string,
  ): Promise<UserModuleRecord | null>;
  findEnabledUserModuleBySlug(
    userId: string,
    slug: string,
  ): Promise<{ id: string; config: unknown } | null>;
  findUserModuleBySlug(
    userId: string,
    slug: string,
  ): Promise<UserModuleRecord | null>;
  findFinanceSummaryRecipients(): Promise<FinanceSummaryRecipientRow[]>;
  updateProfile(
    id: string,
    data: UpdateProfileData,
  ): Promise<UserWithModulesRecord>;
  upsertUserModule(
    userId: string,
    moduleId: string,
    config: Record<string, unknown>,
    isEnabled?: boolean,
  ): Promise<unknown>;
  deleteAccountWithAuthOutbox(userId: string): Promise<void>;
  resetSettingsToDefaults(userId: string): Promise<void>;
  pauseFinanceEmailSyncAutomatic(userId: string): Promise<void>;
  markAuthOutboxCompleted(userId: string): Promise<unknown>;
  claimNextAuthDeletion(maxAttempts: number): Promise<AuthDeletionClaim | null>;
  completeAuthDeletion(id: string): Promise<unknown>;
  failAuthDeletion(
    id: string,
    attempts: number,
    lastError: string,
    nextAttemptAt: Date,
    terminal: boolean,
  ): Promise<unknown>;
}
