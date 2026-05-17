import type { Env } from './env.schema';

export function isBullMqEnabled(config: Pick<Env, 'NODE_ENV' | 'REDIS_URL' | 'REDIS_ENABLED'>): boolean {
  if (config.NODE_ENV === 'test') {
    return false;
  }

  if (!config.REDIS_URL) {
    return false;
  }

  if (config.NODE_ENV === 'production') {
    return true;
  }

  return config.REDIS_ENABLED === true;
}
