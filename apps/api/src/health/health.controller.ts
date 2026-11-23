import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '@personal-os/core';
import { appVersion } from '../app-version';
import type { HealthProbeResponse } from './health.types';
import { HealthCheckRunner } from './probes/health-check-runner';
import { JwksProbe } from './probes/jwks.probe';
import { ReadinessIndicators } from './probes/readiness-indicators';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly runner: HealthCheckRunner,
    private readonly readinessIndicators: ReadinessIndicators,
    private readonly jwks: JwksProbe,
  ) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Sondeo de vida' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        timestamp: { type: 'string', format: 'date-time' },
        version: { type: 'string', example: '1.4.0' },
      },
    },
  })
  liveness(): { status: string; timestamp: string; version: string } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: appVersion(),
    };
  }

  @Get('startup')
  @Public()
  @ApiOperation({
    summary:
      'Startup probe (database, JWKS with timeout and cache, optional Redis). Public; response omits dependency details.',
  })
  @ApiOkResponse({
    description: 'Startup dependencies are ready',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiServiceUnavailableResponse({
    description: 'One or more startup checks failed (no dependency details)',
  })
  startup(): Promise<HealthProbeResponse> {
    return this.runner.run('Startup', [
      ...this.readinessIndicators.list(),
      () => this.jwks.ping(),
    ]);
  }

  @Get('ready')
  @Public()
  @ApiOperation({
    summary:
      'Readiness probe (database, optional Redis). Public for load balancers; response omits dependency details.',
  })
  @ApiOkResponse({
    description: 'All readiness checks passed',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiServiceUnavailableResponse({
    description: 'One or more readiness checks failed (no dependency details)',
  })
  readiness(): Promise<HealthProbeResponse> {
    return this.runner.run('Readiness', this.readinessIndicators.list());
  }
}
