import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  HealthCheckService,
  type HealthIndicatorFunction,
} from '@nestjs/terminus';
import type { HealthProbeResponse } from '../health.types';

@Injectable()
export class HealthCheckRunner {
  private readonly logger = new Logger(HealthCheckRunner.name);

  constructor(private readonly health: HealthCheckService) {}

  async run(
    label: string,
    indicators: HealthIndicatorFunction[],
  ): Promise<HealthProbeResponse> {
    try {
      await this.health.check(indicators);
      return { status: 'ok', timestamp: new Date().toISOString() };
    } catch (error) {
      this.logger.warn(
        `${label} check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new ServiceUnavailableException('Servicio no disponible');
    }
  }
}
