import {
  Controller,
  Get,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  HealthCheckService,
  HttpHealthIndicator,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { type Env, getSupabaseAuthConfig } from '@personal-os/config';
import { Public } from '@personal-os/core';
import { PrismaService } from '@personal-os/database';
import { appVersion } from '../app-version';
import { RedisHealthIndicator } from './indicators/redis.health.indicator';

export type HealthProbeResponse = {
  status: 'ok';
  timestamp: string;
};

@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaHealthIndicator,
    private readonly http: HttpHealthIndicator,
    private readonly prismaService: PrismaService,
    private readonly redisHealthIndicator: RedisHealthIndicator,
    private readonly configService: ConfigService<Env, true>,
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
      'Startup probe (database, JWKS, optional Redis). Public; response omits dependency details.',
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
  async startup(): Promise<HealthProbeResponse> {
    return this.runSanitizedChecks('Startup');
  }

  @Get('ready')
  @Public()
  @ApiOperation({
    summary:
      'Readiness probe (database, JWKS, optional Redis). Public for load balancers; response omits dependency details.',
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
  async readiness(): Promise<HealthProbeResponse> {
    return this.runSanitizedChecks('Readiness');
  }

  private async runSanitizedChecks(
    label: string,
  ): Promise<HealthProbeResponse> {
    const jwksUri = getSupabaseAuthConfig(this.configService).jwksUri;
    const indicators = [
      () => this.prisma.pingCheck('database', this.prismaService),
      () => this.http.pingCheck('jwks', jwksUri),
    ];

    if (this.redisHealthIndicator.isEnabled()) {
      indicators.push(() => this.redisHealthIndicator.pingCheck('redis'));
    }

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
