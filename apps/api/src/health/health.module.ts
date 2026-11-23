import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { RedisHealthIndicator } from './indicators/redis.health.indicator';
import { HealthCheckRunner } from './probes/health-check-runner';
import { JwksProbe } from './probes/jwks.probe';
import { ReadinessIndicators } from './probes/readiness-indicators';

@Module({
  imports: [TerminusModule, HttpModule],
  controllers: [HealthController],
  providers: [
    RedisHealthIndicator,
    ReadinessIndicators,
    JwksProbe,
    HealthCheckRunner,
  ],
})
export class HealthModule {}
