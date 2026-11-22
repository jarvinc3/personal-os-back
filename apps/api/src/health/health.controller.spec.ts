import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HealthCheckService,
  HttpHealthIndicator,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { PrismaService } from '@personal-os/database';
import { HealthController } from './health.controller';
import { RedisHealthIndicator } from './indicators/redis.health.indicator';

describe('HealthController', () => {
  const health = {
    check: jest.fn(),
  } as unknown as HealthCheckService;
  const prismaPingCheck = jest.fn();
  const prismaIndicator = {
    pingCheck: prismaPingCheck,
  } as unknown as PrismaHealthIndicator;
  const httpPingCheck = jest.fn();
  const http = {
    pingCheck: httpPingCheck,
  } as unknown as HttpHealthIndicator;
  const prismaService = {} as PrismaService;
  const redisHealthIndicator = {
    isEnabled: jest.fn().mockReturnValue(false),
    pingCheck: jest.fn(),
  } as unknown as RedisHealthIndicator;
  const configService = {
    getOrThrow: jest.fn().mockReturnValue('https://example.supabase.co'),
    get: jest.fn(),
  } as unknown as ConfigService;

  let controller: HealthController;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    (redisHealthIndicator.isEnabled as jest.Mock).mockReturnValue(false);
    httpPingCheck.mockResolvedValue({
      jwks: { status: 'up' },
    });
    (health.check as jest.Mock).mockImplementation(
      async (indicators: Array<() => Promise<unknown>>) => {
        for (const indicator of indicators) {
          await indicator();
        }
        return { status: 'ok' };
      },
    );
    (configService.getOrThrow as jest.Mock).mockReturnValue(
      'https://example.supabase.co',
    );
    controller = new HealthController(
      health,
      prismaIndicator,
      http,
      prismaService,
      redisHealthIndicator,
      configService as unknown as ConfigService<never, true>,
    );
  });

  it('liveness returns ok', () => {
    const result = controller.liveness();
    expect(result.status).toBe('ok');
    expect(result.timestamp).toEqual(expect.any(String));
  });

  it('readiness returns sanitized ok payload when checks pass', async () => {
    (health.check as jest.Mock).mockResolvedValue({ status: 'ok' });

    const result = await controller.readiness();

    expect(result).toEqual({
      status: 'ok',
      timestamp: expect.any(String),
    });
    expect(result).not.toHaveProperty('info');
    expect(result).not.toHaveProperty('error');
    expect(result).not.toHaveProperty('details');
  });

  it('startup returns sanitized ok payload when checks pass', async () => {
    (health.check as jest.Mock).mockResolvedValue({ status: 'ok' });

    const result = await controller.startup();

    expect(result).toEqual({
      status: 'ok',
      timestamp: expect.any(String),
    });
  });

  it('readiness does not depend on JWKS', async () => {
    await controller.readiness();

    expect(prismaPingCheck).toHaveBeenCalledWith('database', prismaService);
    expect(httpPingCheck).not.toHaveBeenCalled();
  });

  it('startup pings JWKS with a bounded timeout', async () => {
    await controller.startup();

    expect(httpPingCheck).toHaveBeenCalledWith(
      'jwks',
      'https://example.supabase.co/auth/v1/.well-known/jwks.json',
      { timeout: 2_000 },
    );
  });

  it('startup reuses the JWKS result for a minute and retries after it', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-21T00:00:00Z'));

    await controller.startup();
    await controller.startup();
    expect(httpPingCheck).toHaveBeenCalledTimes(1);

    jest.setSystemTime(new Date('2026-11-21T00:01:01Z'));
    await controller.startup();
    expect(httpPingCheck).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });

  it('readiness throws ServiceUnavailableException without dependency details', async () => {
    (health.check as jest.Mock).mockRejectedValue(
      new ServiceUnavailableException({
        status: 'error',
        info: {},
        error: { database: { status: 'down', message: 'ECONNREFUSED' } },
        details: { database: { status: 'down', message: 'ECONNREFUSED' } },
      }),
    );

    await expect(controller.readiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    try {
      await controller.readiness();
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      const exception = error as ServiceUnavailableException;
      expect(exception.getStatus()).toBe(503);
      expect(exception.getResponse()).toEqual(
        expect.objectContaining({ message: 'Servicio no disponible' }),
      );
      const response = exception.getResponse();
      expect(JSON.stringify(response)).not.toContain('database');
      expect(JSON.stringify(response)).not.toContain('ECONNREFUSED');
    }
  });
});
