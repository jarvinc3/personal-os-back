import { ExchangeRateHostAdapter } from './exchange-rate-host.adapter';

const DATE = '2026-11-08';

function setup({
  apiKey = 'test-key',
  cachedExact = null as { rate: string } | null,
  cachedLatest = null as { rate: string; rateDate: Date } | null,
} = {}) {
  const config = {
    get: jest.fn().mockReturnValue(apiKey),
  };
  const prisma = {
    finExchangeRate: {
      findUnique: jest.fn().mockResolvedValue(cachedExact),
      findFirst: jest.fn().mockResolvedValue(cachedLatest),
      upsert: jest.fn().mockResolvedValue({}),
    },
  };
  const adapter = new ExchangeRateHostAdapter(config as never, prisma as never);
  return { adapter, config, prisma };
}

function jsonResponse(
  body: unknown,
  status = 200,
): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

describe('ExchangeRateHostAdapter', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns the exact cached rate with its date', async () => {
    const { adapter, prisma } = setup({ cachedExact: { rate: '60.4617' } });

    await expect(
      adapter.getHistoricalRate({ from: 'USD', to: 'DOP', date: DATE }),
    ).resolves.toMatchObject({
      ok: true,
      rate: 60.4617,
      source: 'cache',
      rateDate: DATE,
    });
    expect(prisma.finExchangeRate.upsert).not.toHaveBeenCalled();
  });

  it('caches and returns an exact rate from the provider', async () => {
    const { adapter, prisma } = setup();
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        jsonResponse({ success: true, quotes: { USDDOP: 60.5 } }),
      );

    await expect(
      adapter.getHistoricalRate({ from: 'USD', to: 'DOP', date: DATE }),
    ).resolves.toMatchObject({
      ok: true,
      rate: 60.5,
      source: 'api',
      rateDate: DATE,
    });
    expect(prisma.finExchangeRate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ rate: 60.5 }),
      }),
    );
  });

  it('reports an HTTP 401 as a provider authorization failure', async () => {
    const { adapter } = setup();
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ error: 'Unauthorized' }, 401));

    const historical = await adapter.getHistoricalRate({
      from: 'USD',
      to: 'DOP',
      date: DATE,
    });
    expect(historical).toMatchObject({
      ok: false,
      code: 'PROVIDER_UNAUTHORIZED',
      providerStatus: 401,
    });
    if (!historical.ok) {
      expect(historical.message).toContain('401');
      expect(historical.message).not.toContain('No exact-date rate');
    }

    const ledger = await adapter.getLedgerRate({
      from: 'USD',
      to: 'DOP',
      date: DATE,
    });
    expect(ledger).toMatchObject({ ok: false, code: 'PROVIDER_UNAUTHORIZED' });
  });

  it('reports a provider rejection by its real reason', async () => {
    const { adapter } = setup();
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        success: false,
        error: { info: 'Access key is invalid' },
      }),
    );

    await expect(
      adapter.getHistoricalRate({ from: 'USD', to: 'DOP', date: DATE }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'PROVIDER_UNAUTHORIZED',
    });
  });

  it('uses the last published rate for a day without a quote', async () => {
    const { adapter } = setup({
      cachedLatest: {
        rate: '60.4617',
        rateDate: new Date('2026-11-06T00:00:00.000Z'),
      },
    });
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, quotes: {} }));

    const historical = await adapter.getHistoricalRate({
      from: 'USD',
      to: 'DOP',
      date: DATE,
    });
    expect(historical).toMatchObject({ ok: false, code: 'NO_EXACT_RATE' });

    const ledger = await adapter.getLedgerRate({
      from: 'USD',
      to: 'DOP',
      date: DATE,
    });
    expect(ledger).toMatchObject({
      ok: true,
      rate: 60.4617,
      source: 'cache_last_published',
      rateDate: '2026-11-06',
    });
  });

  it('does not fall back when the provider is unavailable', async () => {
    const { adapter } = setup({
      cachedLatest: {
        rate: '60.4617',
        rateDate: new Date('2026-11-06T00:00:00.000Z'),
      },
    });
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ error: 'boom' }, 503));

    await expect(
      adapter.getLedgerRate({ from: 'USD', to: 'DOP', date: DATE }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'PROVIDER_UNAVAILABLE',
      providerStatus: 503,
    });
  });

  it('reports a missing key separately', async () => {
    const { adapter } = setup({ apiKey: null as never });

    await expect(
      adapter.getHistoricalRate({ from: 'USD', to: 'DOP', date: DATE }),
    ).resolves.toMatchObject({ ok: false, code: 'API_KEY_MISSING' });
  });
});
