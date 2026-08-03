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
import { type Env, getSupabaseAuthConfig } from '../config';
import { Public } from '../core/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { RedisHealthIndicator } from './indicators/redis.health.indicator';

export type ReadinessResponse = {
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
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  })
  liveness(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
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
  async readiness(): Promise<ReadinessResponse> {
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
        `Readiness check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new ServiceUnavailableException('Service Unavailable');
    }
  }
}
