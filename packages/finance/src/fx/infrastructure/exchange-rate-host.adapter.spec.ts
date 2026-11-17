import { ExchangeRateHostAdapter } from './exchange-rate-host.adapter';

const DATE = '2026-11-08';

function setup({
  apiKey = 'test-key',
  cachedExact = null,
  cachedLatest = null,
  cachedByDate = {},
}: {
  apiKey?: string | null;
  cachedExact?: { rate: string } | null;
  cachedLatest?: { rate: string; rateDate: Date } | null;
  cachedByDate?: Record<string, { rate: string }>;
} = {}) {
  const config = {
    get: jest.fn().mockReturnValue(apiKey),
  };
  const prisma = {
    finExchangeRate: {
      findUnique: jest.fn(
        (args: {
          where: {
            fromCurrency_toCurrency_rateDate: { rateDate: Date };
          };
        }) => {
          const date = args.where.fromCurrency_toCurrency_rateDate.rateDate
            .toISOString()
            .slice(0, 10);
          return Promise.resolve(cachedByDate[date] ?? cachedExact);
        },
      ),
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

    const historical = await adapter.getHistoricalRate({
      from: 'USD',
      to: 'DOP',
      date: DATE,
    });
    expect(historical).toMatchObject({
      ok: false,
      code: 'PROVIDER_UNAUTHORIZED',
    });
    if (!historical.ok) {
      expect(historical.message).toContain('Access key is invalid');
      expect(historical.message).not.toContain('unknown');
    }
  });

  it('uses the last published rate for a day without a quote', async () => {
    const { adapter } = setup({
      cachedByDate: { '2026-11-06': { rate: '60.4617' } },
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

  it('does not use a stale cache when a newer prior publication exists', async () => {
    const { adapter } = setup({
      cachedByDate: { '2026-11-05': { rate: '59.9' } },
    });
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('date=2026-11-06')) {
        return Promise.resolve(
          jsonResponse({ success: true, quotes: { USDDOP: 60.5 } }),
        );
      }
      return Promise.resolve(jsonResponse({ success: true, quotes: {} }));
    });

    await expect(
      adapter.getLedgerRate({ from: 'USD', to: 'DOP', date: DATE }),
    ).resolves.toMatchObject({
      ok: true,
      rate: 60.5,
      source: 'cache_last_published',
      rateDate: '2026-11-06',
    });
  });

  it('reports a provider 400 as a provider error, not a missing rate', async () => {
    const { adapter } = setup({
      cachedByDate: { '2026-11-06': { rate: '60.4617' } },
    });
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ error: 'bad request' }, 400));

    const rateResult = await adapter.getLedgerRate({
      from: 'USD',
      to: 'DOP',
      date: DATE,
    });
    expect(rateResult).toMatchObject({
      ok: false,
      code: 'PROVIDER_ERROR',
      providerStatus: 400,
    });
    if (!rateResult.ok) {
      expect(rateResult.message).toContain('HTTP 400');
    }
  });

  it('reports a quota rejection as unavailable, not a missing rate', async () => {
    const { adapter } = setup({
      cachedByDate: { '2026-11-06': { rate: '60.4617' } },
    });
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        success: false,
        error: { info: 'Quota exceeded' },
      }),
    );

    const rateResult = await adapter.getLedgerRate({
      from: 'USD',
      to: 'DOP',
      date: DATE,
    });
    expect(rateResult).toMatchObject({
      ok: false,
      code: 'PROVIDER_UNAVAILABLE',
    });
    if (!rateResult.ok) {
      expect(rateResult.message).toContain('Quota exceeded');
    }
  });

  it('uses the prior publication only for a confirmed no-data response', async () => {
    const { adapter } = setup({
      cachedByDate: { '2026-11-06': { rate: '60.4617' } },
    });
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        success: false,
        error: { info: 'No data for this date' },
      }),
    );

    await expect(
      adapter.getLedgerRate({ from: 'USD', to: 'DOP', date: DATE }),
    ).resolves.toMatchObject({
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
    const { adapter } = setup({ apiKey: null });

    await expect(
      adapter.getHistoricalRate({ from: 'USD', to: 'DOP', date: DATE }),
    ).resolves.toMatchObject({ ok: false, code: 'API_KEY_MISSING' });
  });
});
