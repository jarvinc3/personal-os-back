import {
  bullmqRedisConnection,
  isBullBoardEnabled,
  isBullMqEnabled,
} from './redis.config';

describe('isBullMqEnabled', () => {
  it('returns false in test even with Redis configured', () => {
    expect(
      isBullMqEnabled({
        NODE_ENV: 'test',
        REDIS_URL: 'redis://localhost:6379',
        REDIS_ENABLED: true,
      }),
    ).toBe(false);
  });

  it('returns false without REDIS_URL', () => {
    expect(
      isBullMqEnabled({
        NODE_ENV: 'development',
        REDIS_URL: undefined,
        REDIS_ENABLED: true,
      }),
    ).toBe(false);
  });

  it('returns true in production when REDIS_URL is set', () => {
    expect(
      isBullMqEnabled({
        NODE_ENV: 'production',
        REDIS_URL: 'redis://localhost:6379',
        REDIS_ENABLED: false,
      }),
    ).toBe(true);
  });
});

describe('isBullBoardEnabled', () => {
  it('returns true in development with Redis enabled', () => {
    expect(
      isBullBoardEnabled({
        NODE_ENV: 'development',
        REDIS_URL: 'redis://localhost:6379',
        REDIS_ENABLED: true,
      }),
    ).toBe(true);
  });

  it('returns false in production even with Redis', () => {
    expect(
      isBullBoardEnabled({
        NODE_ENV: 'production',
        REDIS_URL: 'redis://localhost:6379',
        REDIS_ENABLED: true,
      }),
    ).toBe(false);
  });

  it('returns false in test even with Redis enabled', () => {
    expect(
      isBullBoardEnabled({
        NODE_ENV: 'test',
        REDIS_URL: 'redis://localhost:6379',
        REDIS_ENABLED: true,
      }),
    ).toBe(false);
  });

  it('returns false in development without REDIS_URL', () => {
    expect(
      isBullBoardEnabled({
        NODE_ENV: 'development',
        REDIS_URL: undefined,
        REDIS_ENABLED: true,
      }),
    ).toBe(false);
  });

  it('returns false in development when REDIS_ENABLED is false', () => {
    expect(
      isBullBoardEnabled({
        NODE_ENV: 'development',
        REDIS_URL: 'redis://localhost:6379',
        REDIS_ENABLED: false,
      }),
    ).toBe(false);
  });
});

describe('bullmqRedisConnection', () => {
  it('fails fast instead of queueing commands while Redis is down', () => {
    expect(bullmqRedisConnection('redis://localhost:6379')).toEqual(
      expect.objectContaining({
        url: 'redis://localhost:6379',
        connectTimeout: 2000,
        enableOfflineQueue: false,
      }),
    );
  });
});
