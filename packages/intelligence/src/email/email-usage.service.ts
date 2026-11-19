import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';
import { PrismaService } from '@personal-os/database';
import {
  globalCostStatus,
  readEmailClassificationLimits,
  startOfUtcDay,
  type EmailClassificationLimits,
} from './email-classification-limits';

export type EmailUsageRow = {
  provider: string;
  model: string;
  status: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: unknown;
  sourceId: string | null;
  createdAt: Date;
};

export type EmailUsageMessage = {
  id: string;
  fromDomain: string;
  processingStatus: string;
};

/** El tope diario de 100 llamadas acota el rango: 30 días son menos de 3 000 filas. */
const USAGE_ROW_LIMIT = 5_000;

type UsageBucket = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

const EMPTY_BUCKET: UsageBucket = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
};

/** Agrega las llamadas de clasificación para la vista de uso de web #426. */
export function summarizeEmailUsage({
  rows,
  messages,
  classificationTypes,
}: {
  rows: readonly EmailUsageRow[];
  messages: readonly EmailUsageMessage[];
  classificationTypes: ReadonlyMap<string, string>;
}) {
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const totals: UsageBucket & { succeeded: number; failed: number } = {
    ...EMPTY_BUCKET,
    succeeded: 0,
    failed: 0,
  };
  const byDay = new Map<string, UsageBucket>();
  // Agrega la misma hora de todos los días del rango; el cliente no recibe fecha.
  const byHour = new Map<number, UsageBucket>();
  const byBank = new Map<string, UsageBucket>();
  const byType = new Map<string, UsageBucket>();

  const add = (
    bucket: UsageBucket | undefined,
    { inputTokens, outputTokens, costUsd }: UsageBucket,
  ): UsageBucket => ({
    calls: (bucket?.calls ?? 0) + 1,
    inputTokens: (bucket?.inputTokens ?? 0) + inputTokens,
    outputTokens: (bucket?.outputTokens ?? 0) + outputTokens,
    costUsd: (bucket?.costUsd ?? 0) + costUsd,
  });

  for (const row of rows) {
    const amounts = {
      calls: 1,
      inputTokens: row.inputTokens ?? 0,
      outputTokens: row.outputTokens ?? 0,
      costUsd: Number(row.costUsd ?? 0),
    };
    totals.calls += 1;
    totals.inputTokens += amounts.inputTokens;
    totals.outputTokens += amounts.outputTokens;
    totals.costUsd += amounts.costUsd;
    if (row.status === 'SUCCEEDED') {
      totals.succeeded += 1;
    } else {
      totals.failed += 1;
    }
    const day = row.createdAt.toISOString().slice(0, 10);
    byDay.set(day, add(byDay.get(day), amounts));
    const hour = row.createdAt.getUTCHours();
    byHour.set(hour, add(byHour.get(hour), amounts));
    const message = row.sourceId ? messageById.get(row.sourceId) : undefined;
    const bank = message?.fromDomain ?? 'desconocido';
    byBank.set(bank, add(byBank.get(bank), amounts));
    const type =
      classificationTypes.get(row.sourceId ?? '') ?? 'SIN_CLASIFICACION';
    byType.set(type, add(byType.get(type), amounts));
  }

  return {
    totals,
    byDay: [...byDay.entries()]
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([day, amounts]) => ({ day, ...amounts })),
    byHour: [...byHour.entries()]
      .sort(([first], [second]) => first - second)
      .map(([hour, amounts]) => ({ hour, ...amounts })),
    byBank: [...byBank.entries()]
      .sort(([, first], [, second]) => second.calls - first.calls)
      .map(([bank, amounts]) => ({ bank, ...amounts })),
    byType: [...byType.entries()]
      .sort(([, first], [, second]) => second.calls - first.calls)
      .map(([type, amounts]) => ({ type, ...amounts })),
  };
}

@Injectable()
export class EmailUsageService {
  private readonly limits: EmailClassificationLimits;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {
    this.limits = readEmailClassificationLimits(this.config);
  }

  async getUsage({ userId, days }: { userId: string; days: number }) {
    const today = startOfUtcDay(new Date());
    const from = new Date(today.getTime() - (days - 1) * 86400_000);
    const rows = await this.prisma.aiInference.findMany({
      where: {
        userId,
        task: 'EMAIL_CLASSIFICATION',
        createdAt: { gte: from },
      },
      select: {
        provider: true,
        model: true,
        status: true,
        inputTokens: true,
        outputTokens: true,
        costUsd: true,
        sourceId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
      take: USAGE_ROW_LIMIT,
    });
    const sourceIds = [
      ...new Set(
        rows
          .map((row) => row.sourceId)
          .filter((sourceId): sourceId is string => Boolean(sourceId)),
      ),
    ];
    const messages = sourceIds.length
      ? await this.prisma.aiEmailMessage.findMany({
          where: { userId, id: { in: sourceIds } },
          select: { id: true, fromDomain: true, processingStatus: true },
        })
      : [];
    const classifications = sourceIds.length
      ? await this.prisma.aiEmailClassification.findMany({
          where: { userId, messageId: { in: sourceIds } },
          select: { messageId: true, semanticType: true },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    const classificationTypes = new Map<string, string>();
    for (const classification of classifications) {
      if (!classificationTypes.has(classification.messageId)) {
        classificationTypes.set(
          classification.messageId,
          classification.semanticType,
        );
      }
    }
    const [tokenBudget, connection, dailyCost] = await Promise.all([
      this.prisma.aiEmailTokenBudget.findFirst({
        where: { userId, budgetDate: today },
        select: { tokens: true, tokenLimit: true },
      }),
      this.prisma.aiEmailConnection.findUnique({
        where: { userId },
        select: { initialBudgetRemaining: true },
      }),
      this.prisma.aiEmailDailyCost.findUnique({
        where: { date: today },
        select: { costUsd: true },
      }),
    ]);
    const usedUsd = Number(dailyCost?.costUsd ?? 0);
    return {
      range: {
        days,
        from: from.toISOString(),
        to: new Date().toISOString(),
      },
      ...summarizeEmailUsage({ rows, messages, classificationTypes }),
      caps: {
        perMinute: this.limits.classificationsPerMinute,
        initial: {
          limit: this.limits.initialBudget,
          remaining: connection?.initialBudgetRemaining ?? 0,
        },
        daily: {
          limitTokens: this.limits.dailyTokenBudget,
          usedTokens: tokenBudget?.tokens ?? 0,
        },
        globalCost: {
          limitUsd: this.limits.dailyCostLimitUsd,
          usedUsd,
          alertRatio: this.limits.costAlertRatio,
          status: globalCostStatus({ costUsd: usedUsd, limits: this.limits }),
        },
      },
    };
  }
}
