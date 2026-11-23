import type { BullRootModuleOptions } from '@nestjs/bullmq';
import type { ConfigService } from '@nestjs/config';
import { bullmqRedisConnection } from '@personal-os/config';
import type { Env } from '@personal-os/config';

export function buildBullMqRootOptions(
  config: ConfigService<Env, true>,
): BullRootModuleOptions {
  return {
    connection: bullmqRedisConnection(
      config.getOrThrow('REDIS_URL', { infer: true }),
    ),
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: 500,
      removeOnFail: 1000,
    },
  };
}
