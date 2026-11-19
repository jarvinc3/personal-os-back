import type { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';
import type { PrismaService } from '@personal-os/database';
import {
  AiProviderRateLimiter,
  msUntilNextMinute,
} from './ai-provider-rate-limiter';

function build({
  reservations,
  groqRpm = 30,
  openRouterRpm = 20,
}: {
  reservations: Array<Array<{ calls: number }>>;
  groqRpm?: number;
  openRouterRpm?: number;
}) {
  const queryRaw = jest.fn();
  for (const reservation of reservations) {
    queryRaw.mockResolvedValueOnce(reservation);
  }
  const prisma = {
    $queryRaw: queryRaw,
    aiProviderMinute: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  } as unknown as PrismaService;
  const config = {
    get: (key: string) =>
      key === 'AI_PROVIDER_RPM_GROQ' ? groqRpm : openRouterRpm,
  } as unknown as ConfigService<Env, true>;
  const wait = jest.fn((ms: number) => {
    jest.setSystemTime(Date.now() + ms);
    return Promise.resolve();
  });
  return {
    limiter: new AiProviderRateLimiter(prisma, config, wait),
    queryRaw,
    wait,
  };
}

describe('AiProviderRateLimiter', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-19T12:00:00.000Z') });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses 80 % of the contracted RPM', () => {
    const { limiter } = build({ reservations: [] });

    expect(limiter.limitFor('Groq')).toBe(24);
    expect(limiter.limitFor('OpenRouter')).toBe(16);
    expect(limiter.limitFor('unknown')).toBeNull();
  });

  it('reserves the slot without waiting when the minute has room', async () => {
    const { limiter, queryRaw, wait } = build({
      reservations: [[{ calls: 1 }]],
    });

    await expect(
      limiter.acquire({ providerName: 'Groq', task: 'EMAIL_CLASSIFICATION' }),
    ).resolves.toBe(true);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it('does not count providers without a configured RPM', async () => {
    const { limiter, queryRaw } = build({ reservations: [] });

    await expect(
      limiter.acquire({ providerName: 'Local', task: 'EMAIL_CLASSIFICATION' }),
    ).resolves.toBe(true);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('fails fast outside the email batch when the minute is full', async () => {
    const { limiter, wait } = build({ reservations: [[]] });

    await expect(
      limiter.acquire({ providerName: 'Groq', task: 'AGENT_CHAT' }),
    ).resolves.toBe(false);
    expect(wait).not.toHaveBeenCalled();
  });

  it('waits for the next minute when the email batch fills the minute', async () => {
    const { limiter, wait } = build({
      reservations: [[], [{ calls: 1 }]],
    });

    await expect(
      limiter.acquire({ providerName: 'Groq', task: 'EMAIL_CLASSIFICATION' }),
    ).resolves.toBe(true);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledWith(expect.any(Number));
  });

  it('gives up after the maximum batch wait', async () => {
    const { limiter, wait } = build({
      reservations: [[], [], [], [], [], [], []],
    });

    await expect(
      limiter.acquire({ providerName: 'Groq', task: 'EMAIL_CLASSIFICATION' }),
    ).resolves.toBe(false);
    expect(wait).toHaveBeenCalledTimes(5);
  });

  it('measures the wait until the next minute with a safety margin', () => {
    expect(msUntilNextMinute(new Date('2026-11-19T12:00:00.000Z'))).toBe(
      60_050,
    );
    expect(msUntilNextMinute(new Date('2026-11-19T12:59:30.000Z'))).toBe(
      30_050,
    );
  });
});
