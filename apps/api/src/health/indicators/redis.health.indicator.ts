import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HealthCheckError,
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import Redis from 'ioredis';
import { type Env, isBullMqEnabled } from '@personal-os/config';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly configService: ConfigService<Env, true>,
  ) {}

  isEnabled(): boolean {
    const nodeEnv = this.configService.get('NODE_ENV', { infer: true });
    const redisUrl = this.configService.get('REDIS_URL', { infer: true });
    const redisEnabled = this.configService.get('REDIS_ENABLED', {
      infer: true,
    });

    return isBullMqEnabled({
      NODE_ENV: nodeEnv,
      REDIS_URL: redisUrl,
      REDIS_ENABLED: redisEnabled,
    });
  }

  async pingCheck(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);

    const redisUrl = this.configService.get('REDIS_URL', { infer: true });
    if (!redisUrl) {
      throw new HealthCheckError(
        'Redis URL is not configured',
        indicator.down('Redis URL is missing'),
      );
    }

    const client = new Redis(redisUrl, {
      connectTimeout: 2000,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });

    try {
      await client.connect();
      const pong = await client.ping();
      if (pong !== 'PONG') {
        throw new Error('Unexpected Redis ping response');
      }
      return indicator.up();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Redis connection failed';
      throw new HealthCheckError('Redis check failed', indicator.down(message));
    } finally {
      client.disconnect();
    }
  }
}
