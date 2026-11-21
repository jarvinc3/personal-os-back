import { EmailUsageService, summarizeEmailUsage } from './email-usage.service';

const day = new Date('2026-11-18T10:00:00.000Z');

const message = {
  id: 'message-1',
  fromDomain: 'bhd.com.do',
  processingStatus: 'PROCESSED',
};

describe('summarizeEmailUsage', () => {
  it('agrega por día, hora, banco y tipo', () => {
    const summary = summarizeEmailUsage({
      rows: [
        {
          provider: 'Groq',
          model: 'qwen/qwen3.8-27b',
          status: 'SUCCEEDED',
          inputTokens: 1000,
          outputTokens: 200,
          costUsd: 0.00032,
          sourceId: 'message-1',
          createdAt: day,
        },
        {
          provider: 'OpenRouter',
          model: 'deepseek/deepseek-v4-flash',
          status: 'FAILED',
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
          sourceId: null,
          createdAt: new Date('2026-11-18T11:30:00.000Z'),
        },
      ],
      messages: [message],
      classificationTypes: new Map([['message-1', 'FIN_TRANSACTION']]),
    });

    expect(summary.totals).toEqual({
      calls: 2,
      succeeded: 1,
      failed: 1,
      inputTokens: 1000,
      outputTokens: 200,
      costUsd: 0.00032,
    });
    expect(summary.byDay).toEqual([
      expect.objectContaining({ day: '2026-11-18', calls: 2 }),
    ]);
    expect(summary.byHour).toEqual([
      expect.objectContaining({ hour: 10, calls: 1 }),
      expect.objectContaining({ hour: 11, calls: 1 }),
    ]);
    expect(summary.byBank).toEqual([
      {
        bank: 'bhd.com.do',
        calls: 1,
        inputTokens: 1000,
        outputTokens: 200,
        costUsd: 0.00032,
      },
      {
        bank: 'desconocido',
        calls: 1,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      },
    ]);
    expect(summary.byType).toEqual([
      expect.objectContaining({ type: 'FIN_TRANSACTION', calls: 1 }),
      expect.objectContaining({ type: 'SIN_CLASIFICACION', calls: 1 }),
    ]);
  });
});

const buildConfig = () => ({
  get: jest.fn((key: string) => {
    const values: Record<string, unknown> = {
      AI_EMAIL_CLASSIFICATIONS_PER_MINUTE: 20,
      AI_EMAIL_INITIAL_BUDGET: 500,
      AI_EMAIL_DAILY_TOKEN_BUDGET: 320_000,
      AI_EMAIL_DAILY_COST_LIMIT_USD: 5,
      AI_EMAIL_COST_ALERT_RATIO: 0.8,
      AI_EMAIL_MAX_CONTENT_CHARS: 24_000,
      AI_EMAIL_MAX_SUBJECT_CHARS: 1_000,
      AI_EMAIL_MAX_SENDER_CHARS: 320,
      AI_EMAIL_BANK_SENDER_DOMAINS: ['bhd.com.do'],
    };
    return values[key];
  }),
});

const buildPrisma = (
  connection: { initialBudgetRemaining: number } | null,
  inferenceRows: unknown[] = [],
) =>
  ({
    aiInference: { findMany: jest.fn().mockResolvedValue(inferenceRows) },
    aiEmailConnection: { findUnique: jest.fn().mockResolvedValue(connection) },
    aiEmailDailyCost: { findUnique: jest.fn().mockResolvedValue(null) },
  }) as never;

function inferenceRow({
  inputTokens,
  outputTokens,
  costUsd,
  createdAt,
}: {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  createdAt: Date;
}) {
  return {
    provider: 'Groq',
    model: 'qwen/qwen3.8-27b',
    status: 'SUCCEEDED',
    inputTokens,
    outputTokens,
    costUsd,
    sourceId: null,
    createdAt,
  };
}

describe('EmailUsageService', () => {
  it('muestra en el tope diario los tokens del día UTC que pinta la tabla', async () => {
    const prisma = buildPrisma(null, [
      inferenceRow({
        inputTokens: 1_400,
        outputTokens: 235,
        costUsd: 0.0019,
        createdAt: new Date(),
      }),
      inferenceRow({
        inputTokens: 900,
        outputTokens: 100,
        costUsd: 0.001,
        createdAt: new Date(Date.now() - 2 * 86_400_000),
      }),
    ]);
    const service = new EmailUsageService(prisma, buildConfig() as never);

    const usage = await service.getUsage({ userId: 'user-1', days: 7 });

    expect(usage.caps.daily).toEqual({
      limitTokens: 320_000,
      usedTokens: 1_635,
    });
    expect(usage.caps.perMinute).toBe(20);
    expect(usage.caps.initial).toEqual({
      connected: false,
      limit: 500,
      remaining: 0,
    });
  });

  it('aclara que el costo global es de todas las cuentas', async () => {
    const service = new EmailUsageService(
      buildPrisma(null),
      buildConfig() as never,
    );

    const usage = await service.getUsage({ userId: 'user-1', days: 7 });

    expect(usage.caps.globalCost).toEqual({
      scope: 'ALL_USERS',
      limitUsd: 5,
      usedUsd: 0,
      alertRatio: 0.8,
      status: 'OK',
    });
  });

  it('marca la carga inicial como agotada cuando hay conexión y queda en cero', async () => {
    const prisma = buildPrisma({ initialBudgetRemaining: 0 });
    const service = new EmailUsageService(prisma, buildConfig() as never);

    const usage = await service.getUsage({ userId: 'user-1', days: 7 });

    expect(usage.caps.initial).toEqual({
      connected: true,
      limit: 500,
      remaining: 0,
    });
  });
});
