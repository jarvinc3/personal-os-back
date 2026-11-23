import type {
  JsonObject,
  RoutedSignal,
  SignalConsumer,
} from '@personal-os/contracts';
import type { PrismaService } from '@personal-os/database';
import type { AiSignalConsumerRegistry } from '../signals/ai-signal-consumer.registry';
import type { AiSignalsService } from '../signals/ai-signals.service';

const TARGET_REASONS = [
  'NO_LEDGER_TARGET',
  'AMBIGUOUS_LEDGER_TARGET',
  'TRANSFER_ACCOUNT_',
  'CARD_PAYMENT_',
];

type EmailProductProposalSignalsDependencies = {
  prisma: PrismaService;
  consumers: AiSignalConsumerRegistry;
  signals: AiSignalsService;
};

export function isProductTargetReview(reasons: readonly string[]): boolean {
  return reasons.some((reason) =>
    TARGET_REASONS.some((prefix) => reason.startsWith(prefix)),
  );
}

export function toRoutedSignal(row: {
  id: string;
  userId: string;
  type: string;
  sourceType: string;
  sourceId: string;
  payload: unknown;
  occurredAt: Date;
}): RoutedSignal {
  return {
    signalId: row.id,
    userId: row.userId,
    signalType: row.type,
    schemaVersion: 1,
    occurredAt: row.occurredAt.toISOString(),
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    payload: row.payload as JsonObject,
  };
}

/** Vuelve a pasar por Finance las señales de los correos de una propuesta. */
export class EmailProductProposalSignals {
  private readonly prisma: PrismaService;
  private readonly consumers: AiSignalConsumerRegistry;
  private readonly signals: AiSignalsService;

  constructor({
    prisma,
    consumers,
    signals,
  }: EmailProductProposalSignalsDependencies) {
    this.prisma = prisma;
    this.consumers = consumers;
    this.signals = signals;
  }

  async reevaluateEvidence(
    userId: string,
    proposalId: string,
  ): Promise<number> {
    const evidence = await this.prisma.aiEmailProductProposalEvidence.findMany({
      where: { userId, proposalId },
      select: { messageId: true },
    });
    return this.reevaluateSignals(
      userId,
      evidence.map((item) => item.messageId),
    );
  }

  private async reevaluateSignals(
    userId: string,
    messageIds: readonly string[],
  ): Promise<number> {
    if (!messageIds.length) {
      return 0;
    }
    const rows = await this.prisma.aiSignal.findMany({
      where: {
        userId,
        domain: 'FINANCE',
        sourceType: 'EMAIL_MESSAGE',
        sourceId: { in: [...messageIds] },
        status: 'ROUTED',
      },
      orderBy: [{ detectedAt: 'asc' }, { id: 'asc' }],
    });
    const consumer: SignalConsumer = this.consumers.get('FINANCE');
    let reevaluated = 0;
    for (const row of rows) {
      const signal = toRoutedSignal(row);
      const preview = await consumer.preview?.(signal);
      if (
        preview?.outcome === 'REVIEW_REQUIRED' &&
        isProductTargetReview(preview.reviewReasons ?? [preview.reason ?? ''])
      ) {
        continue;
      }
      const consumerOutcome = await consumer.consume(signal);
      await this.signals.recordConsumerOutcome(userId, row.id, consumerOutcome);
      reevaluated += 1;
    }
    return reevaluated;
  }
}
