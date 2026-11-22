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
  type HealthIndicatorFunction,
  type HealthIndicatorResult,
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

/** Una sonda de JWKS colgada no debe retener la petición ni la conexión. */
const JWKS_PING_TIMEOUT_MS = 2_000;

/** Una sonda pública anónima no debe amplificar tráfico hacia el proveedor. */
const JWKS_RESULT_TTL_MS = 60_000;

@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);
  private jwksResult: HealthIndicatorResult | null = null;
  private jwksCheckedAt = 0;

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
  async startup(): Promise<HealthProbeResponse> {
    return this.runSanitizedChecks('Startup', [
      ...this.coreIndicators(),
      () => this.pingJwks(),
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
  async readiness(): Promise<HealthProbeResponse> {
    return this.runSanitizedChecks('Readiness', this.coreIndicators());
  }

  /**
   * JWKS solo entra en el startup: el readiness no depende de un tercero. El
   * resultado correcto se reutiliza un minuto y un fallo no se guarda, así que
   * la siguiente sonda reintenta en cuanto el proveedor vuelva.
   */
  private async pingJwks(): Promise<HealthIndicatorResult> {
    const cached = this.jwksResult;
    if (cached && Date.now() - this.jwksCheckedAt < JWKS_RESULT_TTL_MS) {
      return cached;
    }
    const jwksUri = getSupabaseAuthConfig(this.configService).jwksUri;
    const jwksCheck = await this.http.pingCheck('jwks', jwksUri, {
      timeout: JWKS_PING_TIMEOUT_MS,
    });
    this.jwksResult = jwksCheck;
    this.jwksCheckedAt = Date.now();
    return jwksCheck;
  }

  private coreIndicators(): HealthIndicatorFunction[] {
    const indicators: HealthIndicatorFunction[] = [
      () => this.prisma.pingCheck('database', this.prismaService),
    ];
    if (this.redisHealthIndicator.isEnabled()) {
      indicators.push(() => this.redisHealthIndicator.pingCheck('redis'));
    }
    return indicators;
  }

  private async runSanitizedChecks(
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
