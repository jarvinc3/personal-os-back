import type { Env } from './env.schema';

/** Used when registering BullMQ before ConfigModule is available (e.g. AppModule imports). */
export function isBullMqEnabledFromProcessEnv(): boolean {
  const nodeEnv = (process.env.NODE_ENV ?? 'development') as Env['NODE_ENV'];
  const redisEnabled =
    process.env.REDIS_ENABLED === 'true' || process.env.REDIS_ENABLED === '1';

  return isBullMqEnabled({
    NODE_ENV: nodeEnv,
    REDIS_URL: process.env.REDIS_URL?.trim() || undefined,
    REDIS_ENABLED: redisEnabled,
  });
}

export function isBullMqEnabled(
  config: Pick<Env, 'NODE_ENV' | 'REDIS_URL' | 'REDIS_ENABLED'>,
): boolean {
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

/** Bull Board UI: development only, and only when BullMQ is enabled. */
export function isBullBoardEnabled(
  config: Pick<Env, 'NODE_ENV' | 'REDIS_URL' | 'REDIS_ENABLED'>,
): boolean {
  if (config.NODE_ENV !== 'development') {
    return false;
  }

  return isBullMqEnabled(config);
}

/** Used when registering Bull Board before ConfigModule is available. */
export function isBullBoardEnabledFromProcessEnv(): boolean {
  const nodeEnv = (process.env.NODE_ENV ?? 'development') as Env['NODE_ENV'];
  const redisEnabled =
    process.env.REDIS_ENABLED === 'true' || process.env.REDIS_ENABLED === '1';

  return isBullBoardEnabled({
    NODE_ENV: nodeEnv,
    REDIS_URL: process.env.REDIS_URL?.trim() || undefined,
    REDIS_ENABLED: redisEnabled,
  });
}

/** BullMQ Redis client: reconnect, but fail commands immediately if disconnected. */
export function bullmqRedisConnection(url: string): {
  url: string;
  connectTimeout: number;
  enableOfflineQueue: boolean;
} {
  return {
    url,
    connectTimeout: 2_000,
    enableOfflineQueue: false,
  };
}
