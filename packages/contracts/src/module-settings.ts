import type { JsonObject, SettingsDescriptor } from './index';

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
