import { Injectable } from '@nestjs/common';
import {
  PrismaHealthIndicator,
  type HealthIndicatorFunction,
} from '@nestjs/terminus';
import { PrismaService } from '@personal-os/database';
import { RedisHealthIndicator } from '../indicators/redis.health.indicator';

@Injectable()
export class ReadinessIndicators {
  constructor(
    private readonly prisma: PrismaHealthIndicator,
    private readonly prismaService: PrismaService,
    private readonly redisHealthIndicator: RedisHealthIndicator,
  ) {}

  list(): HealthIndicatorFunction[] {
    const indicators: HealthIndicatorFunction[] = [
      () => this.prisma.pingCheck('database', this.prismaService),
    ];
    if (this.redisHealthIndicator.isEnabled()) {
      indicators.push(() => this.redisHealthIndicator.pingCheck('redis'));
    }
    return indicators;
  }
}
