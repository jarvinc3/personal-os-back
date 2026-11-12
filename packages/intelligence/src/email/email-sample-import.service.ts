import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  JsonObject,
  RoutedSignal,
  SignalImportPreview,
} from '@personal-os/contracts';
import { PrismaService } from '@personal-os/database';
import { AiEmailClassificationService } from './ai-email-classification.service';
import { buildFinanceSignal } from './email-classification-persistence';
import type { EmailClassification } from './email-classification.util';
import { AiSignalConsumerRegistry } from '../signals/ai-signal-consumer.registry';
import { AiSignalsService } from '../signals/ai-signals.service';

export const SAMPLE_SELECTION_LIMIT = 20;
const SIGNAL_SCHEMA_VERSION = 1;
const FINANCE_DOMAIN = 'FINANCE';
const NO_TRANSACTION_CANDIDATE = 'NO_TRANSACTION_CANDIDATE';
const CLASSIFICATION_UNAVAILABLE = 'CLASSIFICATION_UNAVAILABLE';

const MESSAGE_SELECT = {
  id: true,
  receivedAt: true,
  fromAddress: true,
  fromDomain: true,
  subject: true,
} as const;

export type SampleImportSelection = {
  messageIds?: readonly string[];
  sender?: string;
  dateFrom?: Date;
  dateTo?: Date;
};

type SelectedMessage = {
  messageId: string;
  row: {
    id: string;
    receivedAt: Date;
    fromAddress: string;
    fromDomain: string;
    subject: string;
  } | null;
};

export type SampleClassificationSummary = {
  semanticType: string;
  confidence: number;
  method: 'KNOWLEDGE' | 'DETERMINISTIC' | 'MODEL';
  movementClass: string | null;
  kind: string | null;
  amount: number | null;
  currency: string | null;
  transactionDate: string | null;
  direction: string | null;
};

export type SampleHints = {
  bankReference: string | null;
  merchant: string | null;
  last4: string | null;
};

export type SamplePrediction = {
  outcome: SignalImportPreview['outcome'] | 'UNAVAILABLE';
  reason?: string;
  reviewReasons?: SignalImportPreview['reviewReasons'];
  cardPayment?: SignalImportPreview['cardPayment'];
  movement?: SignalImportPreview['movement'];
};

export type SampleExecution = {
  outcome: SignalImportPreview['outcome'];
  reason?: string;
  transactionId: string | null;
};

export type SampleManifestItem = {
  messageId: string;
  status: 'INCLUDED' | 'NOT_FOUND';
  fromAddress: string | null;
  fromDomain: string | null;
  receivedAt: string | null;
  provider: string | null;
  model: string | null;
  classification: SampleClassificationSummary | null;
  classificationUnavailableReason?: string;
  hints: SampleHints | null;
  signal: { published: boolean; reason?: string };
  prediction: SamplePrediction | null;
  execution?: SampleExecution;
};

export type SampleImportManifest = {
  dryRun: boolean;
  selection: {
    mode: 'IDS' | 'SENDER_WINDOW';
    requested: number;
    included: number;
    cap: number;
    sender?: string;
    dateFrom?: string;
    dateTo?: string;
  };
  summary: {
    included: number;
    notFound: number;
    wouldPublishSignal?: number;
    wouldCreateMovement?: number;
    reviewRequired?: number;
    executed?: {
      applied: number;
      alreadyApplied: number;
      reviewRequired: number;
      rejected: number;
    };
  };
  items: SampleManifestItem[];
};

type ClassificationResult = Awaited<
  ReturnType<AiEmailClassificationService['previewClassification']>
>;

@Injectable()
export class EmailSampleImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly classification: AiEmailClassificationService,
    private readonly consumers: AiSignalConsumerRegistry,
    private readonly signals: AiSignalsService,
  ) {}

  /**
   * Reclasifica e importa solo la muestra pedida. En vista previa no escribe
   * nada; al ejecutar, cada correo pasa por el mismo paso de decisión de Finance.
   */
  async run({
    userId,
    dryRun,
    selection,
  }: {
    userId: string;
    dryRun: boolean;
    selection: SampleImportSelection;
  }): Promise<SampleImportManifest> {
    const resolved = await this.resolveSelection({ userId, selection });
    const items: SampleManifestItem[] = [];
    for (const selected of resolved.selected) {
      items.push(
        dryRun
          ? await this.previewMessage({ userId, selected })
          : await this.executeMessage({ userId, selected }),
      );
    }
    return {
      dryRun,
      selection: {
        mode: resolved.mode,
        requested: resolved.selected.length,
        included: items.filter((item) => item.status === 'INCLUDED').length,
        cap: SAMPLE_SELECTION_LIMIT,
        ...(resolved.mode === 'SENDER_WINDOW'
          ? {
              sender: selection.sender!.trim(),
              dateFrom: selection.dateFrom!.toISOString(),
              dateTo: selection.dateTo!.toISOString(),
            }
          : {}),
      },
      summary: this.summarize({ dryRun, items }),
      items,
    };
  }

  private summarize({
    dryRun,
    items,
  }: {
    dryRun: boolean;
    items: readonly SampleManifestItem[];
  }): SampleImportManifest['summary'] {
    const included = items.filter((item) => item.status === 'INCLUDED');
    const base = {
      included: included.length,
      notFound: items.length - included.length,
    };
    if (dryRun) {
      return {
        ...base,
        wouldPublishSignal: included.filter((item) => item.signal.published)
          .length,
        wouldCreateMovement: included.filter(
          (item) => item.prediction?.movement !== undefined,
        ).length,
        reviewRequired: included.filter(
          (item) => item.prediction?.outcome === 'REVIEW_REQUIRED',
        ).length,
      };
    }
    const outcomes = included.map((item) => item.execution?.outcome);
    return {
      ...base,
      executed: {
        applied: outcomes.filter((outcome) => outcome === 'APPLIED').length,
        alreadyApplied: outcomes.filter(
          (outcome) => outcome === 'ALREADY_APPLIED',
        ).length,
        reviewRequired: outcomes.filter(
          (outcome) => outcome === 'REVIEW_REQUIRED',
        ).length,
        rejected: outcomes.filter((outcome) => outcome === 'REJECTED').length,
      },
    };
  }

  private async resolveSelection({
    userId,
    selection,
  }: {
    userId: string;
    selection: SampleImportSelection;
  }): Promise<{
    mode: 'IDS' | 'SENDER_WINDOW';
    selected: SelectedMessage[];
  }> {
    const hasIds = Array.isArray(selection.messageIds);
    const hasWindow =
      selection.sender !== undefined ||
      selection.dateFrom !== undefined ||
      selection.dateTo !== undefined;
    if (hasIds === hasWindow) {
      throw new BadRequestException(
        'Elige una sola forma de selección: ids o remitente con ventana de fechas',
      );
    }
    if (hasIds) {
      return {
        mode: 'IDS',
        selected: await this.selectByIds({
          userId,
          messageIds: selection.messageIds!,
        }),
      };
    }
    return {
      mode: 'SENDER_WINDOW',
      selected: await this.selectBySender({ userId, selection }),
    };
  }

  private async selectByIds({
    userId,
    messageIds,
  }: {
    userId: string;
    messageIds: readonly string[];
  }): Promise<SelectedMessage[]> {
    const unique = [...new Set(messageIds.map((id) => id.trim()))].filter(
      (id) => id.length > 0,
    );
    if (!unique.length) {
      throw new BadRequestException('La lista de correos está vacía');
    }
    if (unique.length > SAMPLE_SELECTION_LIMIT) {
      throw new BadRequestException(
        `El máximo por corrida es ${SAMPLE_SELECTION_LIMIT} correos`,
      );
    }
    const rows = await this.prisma.aiEmailMessage.findMany({
      where: { userId, id: { in: unique } },
      select: MESSAGE_SELECT,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return unique.map((messageId) => ({
      messageId,
      row: byId.get(messageId) ?? null,
    }));
  }

  private async selectBySender({
    userId,
    selection,
  }: {
    userId: string;
    selection: SampleImportSelection;
  }): Promise<SelectedMessage[]> {
    const sender = selection.sender?.trim();
    if (!sender) {
      throw new BadRequestException('Falta el remitente o banco');
    }
    if (!selection.dateFrom || !selection.dateTo) {
      throw new BadRequestException('Falta la ventana dateFrom/dateTo');
    }
    if (selection.dateFrom > selection.dateTo) {
      throw new BadRequestException('dateFrom no puede ser posterior a dateTo');
    }
    const rows = await this.prisma.aiEmailMessage.findMany({
      where: {
        userId,
        receivedAt: { gte: selection.dateFrom, lte: selection.dateTo },
        OR: [
          { fromDomain: { equals: sender, mode: 'insensitive' } },
          { fromAddress: { equals: sender, mode: 'insensitive' } },
        ],
      },
      select: MESSAGE_SELECT,
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      take: SAMPLE_SELECTION_LIMIT,
    });
    return rows.map((row) => ({ messageId: row.id, row }));
  }

  private async previewMessage({
    userId,
    selected,
  }: {
    userId: string;
    selected: SelectedMessage;
  }): Promise<SampleManifestItem> {
    if (!selected.row) {
      return this.missingItem(selected.messageId, false);
    }
    const classificationOutcome =
      await this.classification.previewClassification({
        userId,
        messageId: selected.messageId,
      });
    return this.buildItem({
      userId,
      selected,
      classificationOutcome,
      apply: false,
    });
  }

  private async executeMessage({
    userId,
    selected,
  }: {
    userId: string;
    selected: SelectedMessage;
  }): Promise<SampleManifestItem> {
    if (!selected.row) {
      return this.missingItem(selected.messageId, true);
    }
    const classificationOutcome =
      await this.classification.reclassifyMessageNow({
        userId,
        messageId: selected.messageId,
      });
    return this.buildItem({
      userId,
      selected,
      classificationOutcome,
      apply: true,
    });
  }

  private missingItem(messageId: string, apply = false): SampleManifestItem {
    return {
      messageId,
      status: 'NOT_FOUND',
      fromAddress: null,
      fromDomain: null,
      receivedAt: null,
      provider: null,
      model: null,
      classification: null,
      hints: null,
      signal: { published: false, reason: 'MESSAGE_NOT_FOUND' },
      prediction: null,
      ...(apply
        ? {
            execution: {
              outcome: 'REJECTED' as const,
              reason: 'MESSAGE_NOT_FOUND',
              transactionId: null,
            },
          }
        : {}),
    };
  }

  private async buildItem({
    userId,
    selected,
    classificationOutcome,
    apply,
  }: {
    userId: string;
    selected: SelectedMessage;
    classificationOutcome: ClassificationResult;
    apply: boolean;
  }): Promise<SampleManifestItem> {
    const row = selected.row!;
    const base = {
      messageId: selected.messageId,
      status: 'INCLUDED' as const,
      fromAddress: row.fromAddress,
      fromDomain: row.fromDomain,
      receivedAt: row.receivedAt.toISOString(),
      provider:
        classificationOutcome.kind === 'classified'
          ? classificationOutcome.provider
          : null,
      model:
        classificationOutcome.kind === 'classified'
          ? classificationOutcome.model
          : null,
    };
    if (classificationOutcome.kind === 'not_found') {
      return this.missingItem(selected.messageId, apply);
    }
    if (classificationOutcome.kind === 'unavailable') {
      return {
        ...base,
        classification: null,
        classificationUnavailableReason: classificationOutcome.reason,
        hints: null,
        signal: { published: false, reason: CLASSIFICATION_UNAVAILABLE },
        prediction: null,
        ...(apply
          ? {
              execution: {
                outcome: 'REJECTED' as const,
                reason: classificationOutcome.reason,
                transactionId: null,
              },
            }
          : {}),
      };
    }

    const classification = classificationOutcome.classification;
    const summary = this.summarizeClassification({
      classification,
      method: classificationOutcome.method,
    });
    const hints = this.hintsOf(classification);
    const records = buildFinanceSignal({
      userId,
      messageId: selected.messageId,
      receivedAt: row.receivedAt,
      classification,
      provenance: {
        method: classificationOutcome.method,
        provider: classificationOutcome.provider,
        model: classificationOutcome.model,
        auditSample: classificationOutcome.auditSample,
        matches: classificationOutcome.knowledgeUsed,
      },
    });
    if (!records) {
      return {
        ...base,
        classification: summary,
        hints,
        signal: { published: false, reason: NO_TRANSACTION_CANDIDATE },
        prediction: null,
        ...(apply
          ? {
              execution: {
                outcome: 'REJECTED' as const,
                reason: NO_TRANSACTION_CANDIDATE,
                transactionId: null,
              },
            }
          : {}),
      };
    }

    const routed = this.routedSignal({ userId, row, records });
    if (!apply) {
      return {
        ...base,
        classification: summary,
        hints,
        signal: { published: true },
        prediction: await this.predictImport(routed),
      };
    }
    const outcome = await this.consumers.get(FINANCE_DOMAIN).consume(routed);
    await this.signals.recordConsumerOutcome(userId, routed.signalId, outcome);
    return {
      ...base,
      classification: summary,
      hints,
      signal: { published: true },
      prediction: null,
      execution: {
        outcome: outcome.outcome,
        reason: outcome.reason,
        transactionId: outcome.domainReferences[0]?.id ?? null,
      },
    };
  }

  private routedSignal({
    userId,
    row,
    records,
  }: {
    userId: string;
    row: NonNullable<SelectedMessage['row']>;
    records: NonNullable<ReturnType<typeof buildFinanceSignal>>;
  }): RoutedSignal {
    return {
      signalId: records.signal.id as string,
      userId,
      signalType: records.signal.type,
      schemaVersion: SIGNAL_SCHEMA_VERSION,
      occurredAt: row.receivedAt.toISOString(),
      sourceType: 'EMAIL_MESSAGE',
      sourceId: row.id,
      payload: records.signal.payload as JsonObject,
    };
  }

  private async predictImport(signal: RoutedSignal): Promise<SamplePrediction> {
    const consumer = this.consumers.get(FINANCE_DOMAIN);
    if (!consumer.preview) {
      return {
        outcome: 'UNAVAILABLE',
        reason: 'CONSUMER_PREVIEW_UNSUPPORTED',
      };
    }
    const preview = await consumer.preview(signal);
    return {
      outcome: preview.outcome,
      reason: preview.reason,
      reviewReasons: preview.reviewReasons,
      cardPayment: preview.cardPayment,
      movement: preview.movement,
    };
  }

  private summarizeClassification({
    classification,
    method,
  }: {
    classification: EmailClassification;
    method: 'KNOWLEDGE' | 'DETERMINISTIC' | 'MODEL';
  }): SampleClassificationSummary {
    const transaction = classification.transaction;
    return {
      semanticType: classification.semanticType,
      confidence: classification.confidence,
      method,
      movementClass: transaction?.movementClass ?? null,
      kind: transaction?.kind ?? null,
      amount: transaction?.amount ?? null,
      currency: transaction?.currency ?? null,
      transactionDate: transaction?.transactionDate ?? null,
      direction: transaction?.direction ?? null,
    };
  }

  private hintsOf(classification: EmailClassification): SampleHints {
    const transaction = classification.transaction;
    return {
      bankReference: transaction?.bankReference ?? null,
      merchant: transaction?.merchant ?? null,
      last4: transaction?.last4 ?? null,
    };
  }
}
