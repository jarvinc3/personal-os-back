import { z } from 'zod';

/** Shared domain constraints aligned with finance/users HTTP DTOs. */
const uuid = z.string().uuid();
const dateString = z.union([
  z.string().date(),
  z.string().datetime({ offset: true }),
  z.string().datetime(),
]);
const moneyAmount = z.number().finite();
const currencyCode = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{3}$/, 'currency must be a 3-letter ISO code'));
const categoryId = uuid;
const optionalNullableString = (max: number) =>
  z.union([z.string().trim().max(max), z.null()]).optional();

const themeValues = ['system', 'light', 'dark'] as const;
const aiTones = ['concise', 'balanced', 'detailed'] as const;
const transactionTypes = ['DEBIT', 'CREDIT'] as const;
const budgetPeriods = ['MONTHLY', 'BIWEEKLY', 'CUSTOM'] as const;
const configurableModuleSlugs = [
  'agenda',
  'projects',
  'health',
  'subscriptions',
] as const;

const PREFERENCES_MAX_JSON_CHARS = 8_000;
const MODULE_CONFIG_MAX_JSON_CHARS = 8_000;

function limitedRecord(maxChars: number, fieldName: string) {
  return z.record(z.string(), z.unknown()).superRefine((value, ctx) => {
    try {
      if (JSON.stringify(value).length > maxChars) {
        ctx.addIssue({
          code: 'custom',
          message: `${fieldName} must serialize to at most ${maxChars} characters`,
        });
      }
    } catch {
      ctx.addIssue({
        code: 'custom',
        message: `${fieldName} must be JSON-serializable`,
      });
    }
  });
}

export const updateUserProfileArgsSchema = z
  .object({
    fullName: z.string().trim().min(1).max(120).optional(),
    avatarUrl: z
      .union([
        z
          .string()
          .trim()
          .max(500)
          .refine(
            (url) => url.length === 0 || /^https:\/\//i.test(url),
            'avatarUrl must be an HTTPS URL or null to remove the avatar',
          ),
        z.null(),
      ])
      .optional(),
    locale: z.string().trim().min(1).max(20).optional(),
    timezone: z.string().trim().min(1).max(100).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.fullName === undefined &&
      value.avatarUrl === undefined &&
      value.locale === undefined &&
      value.timezone === undefined
    ) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Provide at least one of: fullName, avatarUrl, locale, timezone',
      });
    }
  });

export const setThemeArgsSchema = z
  .object({
    value: z.enum(themeValues),
  })
  .strict();

export const updatePreferencesArgsSchema = z
  .object({
    preferences: limitedRecord(PREFERENCES_MAX_JSON_CHARS, 'preferences'),
  })
  .strict();

export const updateAiSettingsArgsSchema = z
  .object({
    tone: z.enum(aiTones).optional(),
    defaultProvider: z
      .union([z.string().trim().min(1).max(64), z.null()])
      .optional(),
    proactiveInsights: z.boolean().optional(),
    confirmBeforeActions: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.tone === undefined &&
      value.defaultProvider === undefined &&
      value.proactiveInsights === undefined &&
      value.confirmBeforeActions === undefined
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Provide at least one AI setting to update',
      });
    }
  });

export const updateNotificationSettingsArgsSchema = z
  .object({
    channels: z
      .object({
        push: z.boolean().optional(),
        email: z.boolean().optional(),
        inApp: z.boolean().optional(),
      })
      .strict()
      .optional(),
    quietHours: z
      .object({
        enabled: z.boolean().optional(),
        start: z
          .string()
          .regex(/^\d{2}:\d{2}$/, 'start must be HH:mm')
          .optional(),
        end: z
          .string()
          .regex(/^\d{2}:\d{2}$/, 'end must be HH:mm')
          .optional(),
        timezone: z
          .union([z.string().trim().min(1).max(100), z.null()])
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.channels === undefined && value.quietHours === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'Provide channels and/or quietHours',
      });
    }
  });

export const updateModuleConfigArgsSchema = z
  .object({
    slug: z.enum(configurableModuleSlugs),
    config: limitedRecord(MODULE_CONFIG_MAX_JSON_CHARS, 'config'),
  })
  .strict();

export const toggleModuleArgsSchema = z
  .object({
    slug: z.enum(configurableModuleSlugs),
    isEnabled: z.boolean(),
  })
  .strict();

export const createTransactionArgsSchema = z
  .object({
    accountId: uuid.nullable().optional(),
    cardId: uuid.nullable().optional(),
    type: z.enum(transactionTypes),
    amount: moneyAmount,
    currency: currencyCode.optional(),
    transactionDate: dateString,
    description: optionalNullableString(2000),
    merchant: optionalNullableString(200),
    categoryId: z.union([categoryId, z.null()]).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasAccount = value.accountId != null;
    const hasCard = value.cardId != null;
    if (hasAccount === hasCard) {
      ctx.addIssue({
        code: 'custom',
        message: 'Provide exactly one of accountId or cardId',
      });
    }
    if (value.currency !== undefined && !/^[A-Z]{3}$/i.test(value.currency)) {
      ctx.addIssue({
        code: 'custom',
        path: ['currency'],
        message: 'currency must be a 3-letter ISO code',
      });
    }
  })
  .transform((value) => ({
    ...value,
    currency: value.currency?.trim().toUpperCase(),
  }));

export const createOrUpdateBudgetArgsSchema = z
  .object({
    budgetId: uuid.nullable().optional(),
    categoryId: categoryId.optional(),
    periodType: z.enum(budgetPeriods).optional(),
    periodStart: dateString.optional(),
    periodEnd: dateString.optional(),
    amountLimit: moneyAmount.optional(),
    alertThresholdPct: moneyAmount.nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.budgetId) {
      if (
        value.categoryId === undefined &&
        value.periodType === undefined &&
        value.periodStart === undefined &&
        value.periodEnd === undefined &&
        value.amountLimit === undefined &&
        value.alertThresholdPct === undefined
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'Provide at least one budget field to update',
        });
      }
      return;
    }

    for (const key of [
      'categoryId',
      'periodType',
      'periodStart',
      'periodEnd',
      'amountLimit',
    ] as const) {
      if (value[key] === undefined || value[key] === null) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required when creating a budget`,
        });
      }
    }
  });

export const createSavingsGoalArgsSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    targetAmount: moneyAmount,
    currentAmount: moneyAmount.nullable().optional(),
    currency: currencyCode.nullable().optional(),
    targetDate: dateString.nullable().optional(),
  })
  .strict();

export const recordSavingsContributionArgsSchema = z
  .object({
    goalId: uuid,
    accountId: uuid,
    amount: moneyAmount,
    contributedAt: dateString.nullable().optional(),
    notes: z.string().trim().max(200).nullable().optional(),
  })
  .strict();

export const updateSavingsGoalArgsSchema = z
  .object({
    goalId: uuid,
    targetAmount: moneyAmount.nullable().optional(),
    name: z.string().trim().min(1).max(120).nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.targetAmount === undefined && value.name === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'Provide at least one field to update on the savings goal',
      });
    }
  });

export const markLoanInstallmentPaidArgsSchema = z
  .object({
    loanId: uuid,
  })
  .strict();

export const triggerEmailSyncArgsSchema = z
  .object({
    sourceId: uuid,
    forceFullSync: z.boolean().optional(),
  })
  .strict();

export const updateTransactionArgsSchema = z
  .object({
    transactionId: uuid,
    categoryId: z.union([uuid, z.null()]).optional(),
    merchant: optionalNullableString(200),
    description: optionalNullableString(2000),
    notes: optionalNullableString(2000),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.categoryId === undefined &&
      value.merchant === undefined &&
      value.description === undefined &&
      value.notes === undefined
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Provide at least one field to update',
      });
    }
  });

export const confirmTransactionArgsSchema = z
  .object({
    transactionId: uuid,
  })
  .strict();

export const unconfirmTransactionArgsSchema = z
  .object({
    transactionId: uuid,
  })
  .strict();

export const createTransferArgsSchema = z
  .object({
    fromAccountId: uuid,
    toAccountId: uuid,
    amount: moneyAmount,
    currency: currencyCode.optional(),
    transactionDate: dateString,
    description: optionalNullableString(200),
    notes: optionalNullableString(2000),
  })
  .strict();

/** Mutating tool name → Zod schema (single source of truth). */
export const MUTATING_TOOL_ARG_SCHEMAS = {
  update_user_profile: updateUserProfileArgsSchema,
  set_theme: setThemeArgsSchema,
  update_preferences: updatePreferencesArgsSchema,
  update_ai_settings: updateAiSettingsArgsSchema,
  update_notification_settings: updateNotificationSettingsArgsSchema,
  update_module_config: updateModuleConfigArgsSchema,
  toggle_module: toggleModuleArgsSchema,
  create_transaction: createTransactionArgsSchema,
  update_transaction: updateTransactionArgsSchema,
  confirm_transaction: confirmTransactionArgsSchema,
  unconfirm_transaction: unconfirmTransactionArgsSchema,
  create_transfer: createTransferArgsSchema,
  create_or_update_budget: createOrUpdateBudgetArgsSchema,
  create_savings_goal: createSavingsGoalArgsSchema,
  update_savings_goal: updateSavingsGoalArgsSchema,
  record_savings_contribution: recordSavingsContributionArgsSchema,
  mark_loan_installment_paid: markLoanInstallmentPaidArgsSchema,
  trigger_email_sync: triggerEmailSyncArgsSchema,
} as const;

export type MutatingToolName = keyof typeof MUTATING_TOOL_ARG_SCHEMAS;

export function isMutatingToolName(name: string): name is MutatingToolName {
  return name in MUTATING_TOOL_ARG_SCHEMAS;
}

export type ValidatedToolArgs<T extends MutatingToolName> = z.infer<
  (typeof MUTATING_TOOL_ARG_SCHEMAS)[T]
>;

export type ToolArgsValidationSuccess = {
  ok: true;
  data: Record<string, unknown>;
};

export type ToolArgsValidationFailure = {
  ok: false;
  message: string;
  issues: Array<{ path: string; message: string }>;
};

export type ToolArgsValidationResult =
  ToolArgsValidationSuccess | ToolArgsValidationFailure;

/**
 * Server-side validation for mutating tools.
 * Non-mutating tools pass through without schema (validated ad-hoc if needed).
 */
export function validateMutatingToolArgs(
  toolName: string,
  args: unknown,
): ToolArgsValidationResult {
  if (!isMutatingToolName(toolName)) {
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
      return {
        ok: false,
        message: 'Tool arguments must be a JSON object',
        issues: [{ path: '', message: 'Expected object' }],
      };
    }
    return { ok: true, data: args as Record<string, unknown> };
  }

  const schema = MUTATING_TOOL_ARG_SCHEMAS[toolName];
  const parsed = schema.safeParse(args);
  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }

  const issues = parsed.error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
  const summary = issues
    .slice(0, 5)
    .map((i) => `${i.path}: ${i.message}`)
    .join('; ');

  return {
    ok: false,
    message: `Invalid arguments for ${toolName}: ${summary}`,
    issues,
  };
}

/** OpenAI-compatible JSON Schema parameters object derived from Zod. */
export function mutatingToolParametersJsonSchema(
  toolName: MutatingToolName,
): Record<string, unknown> {
  const schema = MUTATING_TOOL_ARG_SCHEMAS[toolName];
  const jsonSchema = z.toJSONSchema(schema, {
    target: 'draft-07',
    unrepresentable: 'any',
  }) as Record<string, unknown>;

  // Providers expect a bare parameters object, not a full schema document.
  const parameters = { ...jsonSchema };
  delete parameters.$schema;
  return parameters;
}
