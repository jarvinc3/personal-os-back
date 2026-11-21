import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HealthCheckError,
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import Redis from 'ioredis';
import { type Env, isBullMqEnabled } from '@personal-os/config';

const PROBE_TIMEOUT_MS = 2000;

@Injectable()
export class RedisHealthIndicator implements OnModuleDestroy {
  /** Una sola conexión para todas las sondas; se rehace si la anterior murió. */
  private client: Redis | null = null;

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

    const client = this.connect(redisUrl);

    try {
      const pong = await client.ping();
      if (pong !== 'PONG') {
        throw new Error('Unexpected Redis ping response');
      }
      return indicator.up();
    } catch (error: unknown) {
      this.discard(client);
      const message =
        error instanceof Error ? error.message : 'Redis connection failed';
      throw new HealthCheckError('Redis check failed', indicator.down(message));
    }
  }

  async onModuleDestroy(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (!client) {
      return;
    }
    try {
      await client.quit();
    } catch {
      // La conexión ya no existe: se descarta el socket en vez de esperarlo.
      client.disconnect();
    }
  }

  private connect(redisUrl: string): Redis {
    if (this.client && this.client.status !== 'end') {
      return this.client;
    }
    this.client = new Redis(redisUrl, {
      connectTimeout: PROBE_TIMEOUT_MS,
      commandTimeout: PROBE_TIMEOUT_MS,
      maxRetriesPerRequest: 1,
      // Una sonda no reintenta sola: la siguiente crea una conexión nueva.
      retryStrategy: () => null,
    });
    return this.client;
  }

  private discard(client: Redis): void {
    if (this.client === client) {
      this.client = null;
    }
    client.disconnect();
  }
}
