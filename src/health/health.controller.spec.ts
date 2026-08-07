import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
    HealthCheckService,
    HttpHealthIndicator,
    PrismaHealthIndicator,
} from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';
import { HealthController } from './health.controller';
import { RedisHealthIndicator } from './indicators/redis.health.indicator';

describe('HealthController', () => {
  const health = {
    check: jest.fn(),
  } as unknown as HealthCheckService;
  const prismaIndicator = {
    pingCheck: jest.fn(),
  } as unknown as PrismaHealthIndicator;
  const http = {
    pingCheck: jest.fn(),
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

  const controller = new HealthController(
    health,
    prismaIndicator,
    http,
    prismaService,
    redisHealthIndicator,
    configService as unknown as ConfigService<never, true>,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    redisHealthIndicator.isEnabled = jest.fn().mockReturnValue(false);
    (configService.getOrThrow as jest.Mock).mockReturnValue(
      'https://example.supabase.co',
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
        expect.objectContaining({ message: 'Service Unavailable' }),
      );
      const response = exception.getResponse();
      expect(JSON.stringify(response)).not.toContain('database');
      expect(JSON.stringify(response)).not.toContain('ECONNREFUSED');
    }
  });
});
