import { Injectable } from '@nestjs/common';
import type {
  AiCapabilityDefinition,
  AiExecutionContext,
  JsonObject,
} from '@personal-os/contracts';
import { PrismaService } from '@personal-os/database';
import { z } from 'zod';
import { AnalyticsService } from '../analytics/application/analytics.service';
import type { FinanceAiCapabilitiesPort } from '../contracts';

const monthlySummaryInput = z
  .object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) })
  .strict();

function localDateToUtc(
  year: number,
  monthIndex: number,
  day: number,
  timeZone: string,
): Date {
  const target = Date.UTC(year, monthIndex, day);
  let candidate = target;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(candidate))
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, Number(part.value)]),
    ) as Record<string, number>;
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const adjustment = target - asUtc;
    candidate += adjustment;
    if (!adjustment) {
      break;
    }
  }
  return new Date(candidate);
}

@Injectable()
export class FinanceAiCapabilities implements FinanceAiCapabilitiesPort {
  readonly moduleSlug = 'finance';

  constructor(
    private readonly analytics: AnalyticsService,
    private readonly prisma: PrismaService,
  ) {}

  describe(): readonly AiCapabilityDefinition[] {
    return [
      {
        id: 'finance_monthly_summary',
        moduleSlug: this.moduleSlug,
        version: 1,
        description:
          'Devuelve ingresos, gastos y flujo neto confirmados del mes solicitado en la moneda base del usuario.',
        inputSchema: {
          type: 'object',
          properties: {
            month: {
              type: 'string',
              pattern: '^\\d{4}-(0[1-9]|1[0-2])$',
              description: 'Mes local en formato AAAA-MM.',
            },
          },
          required: ['month'],
          additionalProperties: false,
        },
        outputSchema: {
          type: 'object',
          properties: {
            month: { type: 'string' },
            baseCurrency: { type: 'string' },
            income: { type: 'string' },
            expenses: { type: 'string' },
            cashFlow: { type: 'string' },
          },
          required: ['month', 'baseCurrency', 'income', 'expenses', 'cashFlow'],
          additionalProperties: false,
        },
        effect: 'READ',
        validateInput(value) {
          return monthlySummaryInput.parse(value);
        },
        validateOutput(value) {
          const output =
            value && typeof value === 'object' && !Array.isArray(value)
              ? (value as Record<string, unknown>)
              : null;
          if (
            !output ||
            typeof output.month !== 'string' ||
            typeof output.baseCurrency !== 'string' ||
            typeof output.income !== 'string' ||
            typeof output.expenses !== 'string' ||
            typeof output.cashFlow !== 'string'
          ) {
            throw new Error('Finance monthly summary output is invalid');
          }
          return output as JsonObject;
        },
      },
    ];
  }

  async isAvailable(ctx: AiExecutionContext): Promise<boolean> {
    const enabled = await this.prisma.userModule.findFirst({
      where: {
        userId: ctx.userId,
        isEnabled: true,
        module: { slug: this.moduleSlug },
      },
      select: { id: true },
    });
    return Boolean(enabled);
  }

  async readContext(ctx: AiExecutionContext): Promise<JsonObject> {
    const available = await this.isAvailable(ctx);
    if (!available) {
      return { available: false };
    }
    const user = await this.prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { timezone: true },
    });
    const timeZone = user?.timezone ?? 'America/Santo_Domingo';
    const currentMonth = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
    }).format(new Date());
    return { available: true, timeZone, currentMonth };
  }

  async execute(
    ctx: AiExecutionContext,
    capabilityId: string,
    args: unknown,
  ): Promise<JsonObject> {
    if (capabilityId !== 'finance_monthly_summary') {
      throw new Error('Unknown finance capability');
    }
    const { month } = monthlySummaryInput.parse(args);
    const user = await this.prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { timezone: true },
    });
    const timeZone = user?.timezone ?? 'America/Santo_Domingo';
    const [year, monthNumber] = month.split('-').map(Number);
    const from = localDateToUtc(year, monthNumber - 1, 1, timeZone);
    const nextMonth = localDateToUtc(year, monthNumber, 1, timeZone);
    const result = await this.analytics.getAnalyticsSummary(
      ctx.userId,
      from.toISOString(),
      new Date(nextMonth.getTime() - 1).toISOString(),
    );
    return {
      month,
      baseCurrency: result.baseCurrency,
      income: result.totals.income,
      expenses: result.totals.expenses,
      cashFlow: result.cashFlow,
    };
  }
}
