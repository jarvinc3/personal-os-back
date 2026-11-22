import type { JsonObject } from './primitives';

export const MODULE_SETTINGS_READER = Symbol.for(
  'personal-os.contracts.module-settings-reader',
);
export const MODULE_SETTINGS_REGISTRY = Symbol.for(
  'personal-os.contracts.module-settings-registry',
);

export interface SettingsDescriptor<T extends JsonObject = JsonObject> {
  readonly slug: string;
  readonly version: number;
  readonly defaults: Readonly<T>;
  // Module-owned migration/merge/validation; registry has no business fields.
  normalize(stored: unknown): T;
  applyPatch(current: T, patch: unknown): T;
  notificationEnabled(config: T, key: string): boolean;
}
export interface ModuleSettingsRegistry {
  register(descriptor: SettingsDescriptor): void;
  has(slug: string): boolean;
  get(slug: string): SettingsDescriptor;
  list(): readonly SettingsDescriptor[];
  normalize(slug: string, stored: unknown): JsonObject;
  applyPatch(slug: string, current: unknown, patch: unknown): JsonObject;
}
export interface ModuleSettingsReader {
  hasDescriptor(slug: string): boolean;
  read(
    userId: string,
    slug: string,
  ): Promise<{ enabled: boolean; version: number; config: JsonObject }>;
  notificationEnabled(
    userId: string,
    slug: string,
    key: string,
  ): Promise<boolean>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeSettings(
  partial: unknown,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  if (!isRecord(partial)) {
    return structuredClone(defaults);
  }

  const result = structuredClone(defaults);
  for (const [key, value] of Object.entries(partial)) {
    if (value === undefined) {
      continue;
    }
    result[key] =
      isRecord(value) && isRecord(result[key])
        ? mergeSettings(value, result[key])
        : structuredClone(value);
  }
  return result;
}

export function createSettingsDescriptor<T extends JsonObject>(options: {
  slug: string;
  version: number;
  defaults: Readonly<T>;
  validate?: (config: T) => void;
}): SettingsDescriptor<T> {
  const normalize = (stored: unknown): T => {
    const config = mergeSettings(stored, options.defaults) as T;
    options.validate?.(config);
    return config;
  };

  return {
    slug: options.slug,
    version: options.version,
    defaults: structuredClone(options.defaults),
    normalize,
    applyPatch(current, patch) {
      return normalize(
        mergeSettings(patch, mergeSettings(current, options.defaults)),
      );
    },
    notificationEnabled(config, key) {
      const notifications = config.notifications;
      if (!isRecord(notifications)) {
        return true;
      }
      return notifications[key] !== false;
    },
  };
}
