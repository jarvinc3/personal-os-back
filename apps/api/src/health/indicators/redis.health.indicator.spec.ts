import { ConfigService } from '@nestjs/config';
import { HealthCheckError, HealthIndicatorService } from '@nestjs/terminus';
import Redis from 'ioredis';
import { type Env } from '@personal-os/config';
import { RedisHealthIndicator } from './redis.health.indicator';

jest.mock('ioredis');

const RedisConstructor = Redis as unknown as jest.Mock;

type FakeClient = {
  status: string;
  ping: jest.Mock;
  quit: jest.Mock;
  disconnect: jest.Mock;
};

function fakeClient(overrides: Partial<FakeClient> = {}): FakeClient {
  return {
    status: 'ready',
    ping: jest.fn().mockResolvedValue('PONG'),
    quit: jest.fn().mockResolvedValue('OK'),
    disconnect: jest.fn(),
    ...overrides,
  };
}

function buildIndicator() {
  const indicator = {
    up: jest.fn(() => ({ redis: { status: 'up' } })),
    down: jest.fn((message: string) => ({
      redis: { status: 'down', message },
    })),
  };
  const healthIndicatorService = {
    check: jest.fn(() => indicator),
  } as unknown as HealthIndicatorService;
  const configService = {
    get: jest.fn((key: string) =>
      key === 'REDIS_URL' ? 'redis://localhost:6379' : undefined,
    ),
  } as unknown as ConfigService<Env, true>;

  return {
    indicator: new RedisHealthIndicator(healthIndicatorService, configService),
    checks: indicator,
  };
}

describe('RedisHealthIndicator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    RedisConstructor.mockReset();
  });

  it('reutiliza la misma conexión entre sondas', async () => {
    const client = fakeClient();
    RedisConstructor.mockReturnValue(client);
    const { indicator } = buildIndicator();

    await indicator.pingCheck('redis');
    await indicator.pingCheck('redis');

    expect(RedisConstructor).toHaveBeenCalledTimes(1);
    expect(client.ping).toHaveBeenCalledTimes(2);
  });

  it('descarta la conexión caída y abre otra en la sonda siguiente', async () => {
    const broken = fakeClient({
      ping: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
    });
    RedisConstructor.mockReturnValueOnce(broken);
    const healthy = fakeClient();
    RedisConstructor.mockReturnValueOnce(healthy);
    const { indicator, checks } = buildIndicator();

    await expect(indicator.pingCheck('redis')).rejects.toThrow(
      HealthCheckError,
    );
    expect(broken.disconnect).toHaveBeenCalled();
    expect(checks.down).toHaveBeenCalledWith('connect ECONNREFUSED');

    await expect(indicator.pingCheck('redis')).resolves.toEqual({
      redis: { status: 'up' },
    });
    expect(RedisConstructor).toHaveBeenCalledTimes(2);
  });

  it('cierra la conexión al apagar el módulo', async () => {
    const client = fakeClient();
    RedisConstructor.mockReturnValue(client);
    const { indicator } = buildIndicator();

    await indicator.pingCheck('redis');
    await indicator.onModuleDestroy();

    expect(client.quit).toHaveBeenCalledTimes(1);
  });
});
