import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  HttpHealthIndicator,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { type Env, getSupabaseAuthConfig } from '../config';
import { Public } from '../core/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { RedisHealthIndicator } from './indicators/redis.health.indicator';

@ApiTags('health')
@Controller('health')
export class HealthController {
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
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness probe (database, JWKS, optional Redis)' })
  @ApiBearerAuth('access-token')
  readiness() {
    const jwksUri = getSupabaseAuthConfig(this.configService).jwksUri;
    const indicators = [
      () => this.prisma.pingCheck('database', this.prismaService),
      () => this.http.pingCheck('jwks', jwksUri),
    ];

    if (this.redisHealthIndicator.isEnabled()) {
      indicators.push(() => this.redisHealthIndicator.pingCheck('redis'));
    }

    return this.health.check(indicators);
  }
}
