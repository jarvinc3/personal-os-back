import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type {
  JsonObject,
  RoutedSignal,
  SignalImportPreview,
} from '@personal-os/contracts';
import { QueueNames, type AiEmailSampleImportJob } from '@personal-os/core';
import { PrismaService } from '@personal-os/database';
import { AiEmailClassificationService } from './ai-email-classification.service';
import { buildFinanceSignal } from './email-classification-persistence';
import type { EmailClassification } from './email-classification.util';
import {
  SAMPLE_IMPORT_ERROR,
  SAMPLE_IMPORT_JOB_NAME,
  SAMPLE_IMPORT_JOB_OPTIONS,
} from './email-sample-import-job.constants';
import {
  EmailSampleImportJobsRepository,
  type SampleImportJobRow,
  type SampleImportStatus,
} from './email-sample-import-jobs.repository';
import { AiSignalConsumerRegistry } from '../signals/ai-signal-consumer.registry';
import { AiSignalsService } from '../signals/ai-signals.service';

export const SAMPLE_SELECTION_LIMIT = 20;
export const DRY_RUN_SELECTION_LIMIT = 50;
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

const NOT_FOUND_JOB_MESSAGE = 'Trabajo de muestra de correos no encontrado';

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

export type SampleImportJobProgress = {
  processed: number;
  total: number;
};

/** Reference the owner polls: status, progress and the terminal manifest. */
export type SampleImportJobView = {
  id: string;
  status: SampleImportStatus;
  dryRun: boolean;
  progress: SampleImportJobProgress;
  result: SampleImportManifest | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

type StartSampleImportInput = {
  userId: string;
  dryRun: boolean;
  selection: SampleImportSelection;
};

/** Mode and window kept in the job row so the manifest reads the same later. */
type ReportedSelection = {
  mode: 'IDS' | 'SENDER_WINDOW';
  sender?: string;
  dateFrom?: Date;
  dateTo?: Date;
};

type RunSampleImportInput = StartSampleImportInput & {
  reportedSelection?: ReportedSelection;
  onProgress?: (processed: number) => Promise<void>;
};

type ResolvedSelection = ReportedSelection & { selected: SelectedMessage[] };

type SenderWindow = { sender: string; dateFrom: Date; dateTo: Date };

@Injectable()
export class EmailSampleImportService {
  private readonly logger = new Logger(EmailSampleImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: EmailSampleImportJobsRepository,
    private readonly classification: AiEmailClassificationService,
    private readonly consumers: AiSignalConsumerRegistry,
    private readonly signals: AiSignalsService,
    @Optional()
    @InjectQueue(QueueNames.AI_EMAIL_SAMPLE_IMPORT)
    private readonly queue?: Queue<AiEmailSampleImportJob>,
  ) {}

  /**
   * Creates the job and returns its reference before the messages are
   * processed. With Redis the run happens in a worker; without it the run
   * continues in this process once the response is on its way.
   */
  async start({
    userId,
    dryRun,
    selection,
  }: StartSampleImportInput): Promise<SampleImportJobView> {
    const resolved = await this.resolveSelection({
      userId,
      selection,
      limit: selectionLimit(dryRun),
    });
    const job = await this.jobs.create({
      userId,
      dryRun,
      selectionMode: resolved.mode,
      messageIds: resolved.selected.map((selected) => selected.messageId),
      sender: resolved.sender ?? null,
      dateFrom: resolved.dateFrom ?? null,
      dateTo: resolved.dateTo ?? null,
    });
    if (this.queue) {
      await this.queue.add(
        SAMPLE_IMPORT_JOB_NAME,
        { userId, sampleImportId: job.id },
        { ...SAMPLE_IMPORT_JOB_OPTIONS, jobId: job.id },
      );
    } else {
      void this.process(job.id).catch((error: unknown) => {
        this.logger.error(
          `Sample import ${job.id} could not start: ${errorMessage(error)}`,
        );
      });
    }
    return this.toView(job);
  }

  async getForUser(
    userId: string,
    jobId: string,
  ): Promise<SampleImportJobView> {
    const job = await this.jobs.findForUser(userId, jobId);
    if (!job) {
      throw new NotFoundException(NOT_FOUND_JOB_MESSAGE);
    }
    return this.toView(job);
  }

  /** Runs a queued job once. A job already running or finished is left alone. */
  async process(jobId: string): Promise<void> {
    const job = await this.jobs.claim(jobId);
    if (!job) {
      return;
    }
    try {
      const manifest = await this.run({
        userId: job.userId,
        dryRun: job.dryRun,
        selection: { messageIds: job.messageIds },
        reportedSelection: {
          mode: job.selectionMode,
          sender: job.sender ?? undefined,
          dateFrom: job.dateFrom ?? undefined,
          dateTo: job.dateTo ?? undefined,
        },
        onProgress: (processed) => this.jobs.updateProgress(job.id, processed),
      });
      await this.jobs.complete(job.id, manifest);
    } catch (error) {
      this.logger.error(
        `Sample import ${job.id} failed: ${errorMessage(error)}`,
      );
      await this.jobs.fail(job.id, SAMPLE_IMPORT_ERROR.RUN_FAILED);
    }
  }

  /**
   * Reclasifica e importa solo la muestra pedida. En vista previa no escribe
   * nada; al ejecutar, cada correo pasa por el mismo paso de decisión de Finance.
   */
  async run({
    userId,
    dryRun,
    selection,
    reportedSelection,
    onProgress,
  }: RunSampleImportInput): Promise<SampleImportManifest> {
    const limit = selectionLimit(dryRun);
    const resolved = await this.resolveSelection({
      userId,
      selection,
      limit,
    });
    const items: SampleManifestItem[] = [];
    for (const [index, selected] of resolved.selected.entries()) {
      items.push(
        dryRun
          ? await this.previewMessage({ userId, selected })
          : await this.executeMessage({ userId, selected }),
      );
      await onProgress?.(index + 1);
    }
    return {
      dryRun,
      selection: this.manifestSelection({
        resolved,
        items,
        limit,
        reportedSelection,
      }),
      summary: this.summarize({ dryRun, items }),
      items,
    };
  }

  private manifestSelection({
    resolved,
    items,
    limit,
    reportedSelection,
  }: {
    resolved: ResolvedSelection;
    items: readonly SampleManifestItem[];
    limit: number;
    reportedSelection?: ReportedSelection;
  }): SampleImportManifest['selection'] {
    const mode = reportedSelection?.mode ?? resolved.mode;
    const sender = reportedSelection?.sender ?? resolved.sender;
    const dateFrom = reportedSelection?.dateFrom ?? resolved.dateFrom;
    const dateTo = reportedSelection?.dateTo ?? resolved.dateTo;
    return {
      mode,
      requested: resolved.selected.length,
      included: items.filter((item) => item.status === 'INCLUDED').length,
      cap: limit,
      ...(mode === 'SENDER_WINDOW'
        ? {
            sender: sender!,
            dateFrom: dateFrom!.toISOString(),
            dateTo: dateTo!.toISOString(),
          }
        : {}),
    };
  }

  private toView(job: SampleImportJobRow): SampleImportJobView {
    return {
      id: job.id,
      status: job.status,
      dryRun: job.dryRun,
      progress: { processed: job.processed, total: job.total },
      result: (job.result ?? null) as unknown as SampleImportManifest | null,
      error: job.error,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      finishedAt: job.finishedAt?.toISOString() ?? null,
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
    limit,
  }: {
    userId: string;
    selection: SampleImportSelection;
    limit: number;
  }): Promise<ResolvedSelection> {
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
          limit,
        }),
      };
    }
    const window = requireSenderWindow(selection);
    return {
      mode: 'SENDER_WINDOW',
      ...window,
      selected: await this.selectBySender({ userId, window, limit }),
    };
  }

  private async selectByIds({
    userId,
    messageIds,
    limit,
  }: {
    userId: string;
    messageIds: readonly string[];
    limit: number;
  }): Promise<SelectedMessage[]> {
    const unique = [...new Set(messageIds.map((id) => id.trim()))].filter(
      (id) => id.length > 0,
    );
    if (!unique.length) {
      throw new BadRequestException('La lista de correos está vacía');
    }
    if (unique.length > limit) {
      throw new BadRequestException(
        `El máximo por corrida es ${limit} correos`,
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
    window,
    limit,
  }: {
    userId: string;
    window: SenderWindow;
    limit: number;
  }): Promise<SelectedMessage[]> {
    const rows = await this.prisma.aiEmailMessage.findMany({
      where: {
        userId,
        receivedAt: { gte: window.dateFrom, lte: window.dateTo },
        OR: [
          { fromDomain: { equals: window.sender, mode: 'insensitive' } },
          { fromAddress: { equals: window.sender, mode: 'insensitive' } },
        ],
      },
      select: MESSAGE_SELECT,
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      take: limit,
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

function selectionLimit(dryRun: boolean): number {
  return dryRun ? DRY_RUN_SELECTION_LIMIT : SAMPLE_SELECTION_LIMIT;
}

function requireSenderWindow(selection: SampleImportSelection): SenderWindow {
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
  return {
    sender,
    dateFrom: selection.dateFrom,
    dateTo: selection.dateTo,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
