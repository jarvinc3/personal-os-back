import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';
import {
  EMAIL_PRODUCT_HINTS,
  INFERENCE_COMPLETION,
  MODULE_SETTINGS_READER,
  NOTIFICATION_INTENT_SINK,
  StructuredInferenceOutputError,
  type EmailProductHints,
  type EmailProductHintsPort,
  type InferenceCompletionPort,
  type ModuleSettingsReader,
  type NotificationIntentSink,
  type StructuredInference,
} from '@personal-os/contracts';
import { Prisma, PrismaService } from '@personal-os/database';
import {
  EmailClassificationBudget,
  type ModelBudgetGrant,
} from './ai-email-classification-budget';
import { EmailClassificationDailyLimits } from './ai-email-classification-daily-limits';
import {
  classifyEmailWithModel,
  inferenceTokens,
  sumKnownCosts,
  sumKnownTokens,
} from './ai-email-classification-inference';
import {
  EmailKnowledgeResolver,
  readKnowledgeLabel,
} from './ai-email-classification-knowledge';
import { EmailClassificationNotices } from './ai-email-classification-notices';
import type {
  ClassifiableMessage,
  ClassificationMethod,
  ComputedClassification,
  KnowledgeMatch,
  MessageClassificationResult,
  ModelBudget,
} from './ai-email-classification.types';
import {
  EMAIL_DATASET_NAME,
  EMAIL_DATASET_PURPOSE,
} from '../evidence/dataset.constants';
import { partitionEmailDatasetItem } from '../evidence/dataset-partition.util';
import { groundBhdClassification, isBhdEmail } from './bhd-email-grounding';
import { groundClassificationCurrency } from './email-currency-grounding';
import { parseBhdFixedFormat } from './bhd-email-format';
import { groundAccountLast4FromText } from './email-account-last4-grounding';
import {
  EMAIL_CLASSIFICATION_VERSIONS,
  isRecallAuditSample,
  parseDeterministicEmail,
  validateModelClassification,
  withSuggestedTransactionDate,
  type EmailClassification,
} from './email-classification.util';
import {
  buildClassificationRows,
  buildFinanceSignal,
  classificationLabel,
  EMAIL_REVIEW_CONFIDENCE_THRESHOLD,
  knowledgeUsedRefs,
  requiresReview,
  type ClassificationProvenance,
} from './email-classification-persistence';
import {
  defaultEmailReviewSettings,
  loadEmailReviewSettings,
  type EmailReviewSettings,
} from './email-review-settings';
import { NORMALIZER_VERSION } from '../knowledge/knowledge-normalizer';
import { POLICY_VERSION } from '../knowledge/knowledge-policy';
import { PROJECTOR_VERSION } from '../knowledge/knowledge-projector';
import {
  isBankSenderDomain,
  readEmailClassificationLimits,
  type EmailClassificationLimits,
} from './email-classification-limits';

const RECALL_AUDIT_RATE = 100;
const CLASSIFICATION_BATCH_SIZE = 100;
const STALE_CLAIM_MS = 10 * 60_000;

export type { MessageClassificationResult } from './ai-email-classification.types';

@Injectable()
export class AiEmailClassificationService {
  private readonly logger = new Logger(AiEmailClassificationService.name);
  private readonly limits: EmailClassificationLimits;
  private readonly budget: EmailClassificationBudget;
  private readonly dailyLimits: EmailClassificationDailyLimits;
  private readonly knowledge: EmailKnowledgeResolver;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(INFERENCE_COMPLETION)
    private readonly inference: InferenceCompletionPort,
    private readonly config: ConfigService<Env, true>,
    @Optional()
    @Inject(MODULE_SETTINGS_READER)
    private readonly moduleSettings?: ModuleSettingsReader,
    @Optional()
    @Inject(EMAIL_PRODUCT_HINTS)
    private readonly productHints?: EmailProductHintsPort,
    @Optional()
    @Inject(NOTIFICATION_INTENT_SINK)
    private readonly notifications?: NotificationIntentSink,
  ) {
    this.limits = readEmailClassificationLimits(this.config);
    const notices = new EmailClassificationNotices({
      prisma: this.prisma,
      limits: this.limits,
      logger: this.logger,
      notifications: this.notifications,
    });
    this.dailyLimits = new EmailClassificationDailyLimits({
      prisma: this.prisma,
      limits: this.limits,
      notices,
    });
    this.budget = new EmailClassificationBudget({
      prisma: this.prisma,
      limits: this.limits,
      dailyLimits: this.dailyLimits,
      notices,
    });
    this.knowledge = new EmailKnowledgeResolver(this.prisma);
  }

  /** Processes a bounded batch; model calls use a per-user UTC-day budget. */
  async processPendingForUser(userId: string) {
    const pending = await this.prisma.aiEmailMessage.findMany({
      where: this.pendingForUserWhere(userId),
      select: { id: true },
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
      take: CLASSIFICATION_BATCH_SIZE,
    });

    let modelCalls = 0;
    let processed = 0;
    let rateLimited = false;
    const reviewSettings = pending.length
      ? await loadEmailReviewSettings(this.moduleSettings, userId)
      : defaultEmailReviewSettings();
    for (const candidate of pending) {
      const result = await this.classifyOne(
        userId,
        candidate.id,
        reviewSettings,
      );
      modelCalls += result.modelCalls;
      if (result.processed) {
        processed += 1;
      }
      if (result.rateLimited) {
        rateLimited = true;
        break;
      }
      if (result.budgetExhausted) {
        break;
      }
    }
    return { processed, modelCalls, rateLimited };
  }

  /** Cuánto correo queda por clasificar con el mismo criterio de la próxima pasada. */
  async countPendingForUser(userId: string): Promise<number> {
    return this.prisma.aiEmailMessage.count({
      where: this.pendingForUserWhere(userId),
    });
  }

  private pendingForUserWhere(userId: string): Prisma.AiEmailMessageWhereInput {
    const staleClaimAt = new Date(Date.now() - STALE_CLAIM_MS);
    return {
      userId,
      OR: [
        { processingStatus: { in: ['INGESTED', 'QUEUED'] } },
        {
          processingStatus: 'CLASSIFYING',
          OR: [
            { classificationStartedAt: { lt: staleClaimAt } },
            { classificationStartedAt: null },
          ],
        },
      ],
    };
  }

  private async classifyOne(
    userId: string,
    messageId: string,
    reviewSettings: EmailReviewSettings,
  ): Promise<{
    processed: boolean;
    modelCalls: number;
    budgetExhausted?: boolean;
    rateLimited?: boolean;
  }> {
    const claim = await this.prisma.aiEmailMessage.updateMany({
      where: {
        id: messageId,
        userId,
        OR: [
          { processingStatus: { in: ['INGESTED', 'QUEUED'] } },
          {
            processingStatus: 'CLASSIFYING',
            OR: [
              {
                classificationStartedAt: {
                  lt: new Date(Date.now() - STALE_CLAIM_MS),
                },
              },
              { classificationStartedAt: null },
            ],
          },
        ],
      },
      data: {
        processingStatus: 'CLASSIFYING',
        classificationStartedAt: new Date(),
      },
    });
    if (claim.count === 0) {
      return { processed: false, modelCalls: 0 };
    }

    const message = await this.prisma.aiEmailMessage.findFirst({
      where: { id: messageId, userId },
      include: { content: true },
    });
    if (!message) {
      return { processed: false, modelCalls: 0 };
    }

    let modelCalls = 0;
    try {
      const computation = await this.computeClassification({
        userId,
        message,
        modelBudget: 'reserve',
        onModelCall: () => {
          modelCalls += 1;
        },
      });
      if (computation.kind === 'budget_exhausted') {
        await this.leaveQueued(messageId, userId);
        return { processed: false, modelCalls, budgetExhausted: true };
      }
      if (computation.kind === 'rate_limited') {
        await this.leaveQueued(messageId, userId);
        return { processed: false, modelCalls, rateLimited: true };
      }
      if (computation.kind === 'no_classification') {
        await this.leaveQueued(messageId, userId);
        return { processed: false, modelCalls };
      }
      const isHoldout =
        partitionEmailDatasetItem(userId, message.id) === 'HOLDOUT';
      await this.persistClassification({
        userId,
        message,
        classification: computation.classification,
        method: computation.method,
        provider: computation.provider,
        model: computation.model,
        auditSample: computation.auditSample,
        matches: computation.matches,
        reviewConfidenceThreshold: isHoldout
          ? EMAIL_REVIEW_CONFIDENCE_THRESHOLD
          : reviewSettings.reviewConfidenceThreshold,
        isHoldout,
        verifiedSender: computation.verifiedSender,
        acceptVerifiedSenders: reviewSettings.acceptVerifiedSenders,
      });
      return { processed: true, modelCalls };
    } catch (error) {
      this.logger.warn(
        `Email classification failed for message ${messageId}: ${this.safeErrorDescription(error)}`,
      );
      await this.persistFailure(userId, messageId);
      return { processed: true, modelCalls };
    }
  }

  /**
   * Clasifica un correo concreto para un manifiesto. No reserva presupuesto, no
   * cambia el estado del correo y no guarda clasificaciones ni señales.
   */
  async previewClassification({
    userId,
    messageId,
  }: {
    userId: string;
    messageId: string;
  }): Promise<MessageClassificationResult> {
    const message = await this.prisma.aiEmailMessage.findFirst({
      where: { id: messageId, userId },
      include: { content: true },
    });
    if (!message) {
      return { kind: 'not_found' };
    }
    try {
      return this.classificationResult(
        await this.computeClassification({
          userId,
          message,
          modelBudget: 'inspect',
          recordTelemetry: false,
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Email classification preview failed for message ${messageId}: ${this.safeErrorDescription(error)}`,
      );
      return { kind: 'unavailable', reason: this.safeErrorCode(error) };
    }
  }

  /**
   * Reclasifica un correo concreto sin pasar por la sincronización. Reemplaza su
   * clasificación guardada y publica su señal, sin ampliar a plantilla ni remitente.
   */
  async reclassifyMessageNow({
    userId,
    messageId,
  }: {
    userId: string;
    messageId: string;
  }): Promise<MessageClassificationResult> {
    const message = await this.prisma.aiEmailMessage.findFirst({
      where: { id: messageId, userId },
      include: { content: true },
    });
    if (!message) {
      return { kind: 'not_found' };
    }
    const previousStatus = message.processingStatus;
    await this.claimForReclassification({ userId, messageId });
    try {
      const reviewSettings = await loadEmailReviewSettings(
        this.moduleSettings,
        userId,
      );
      const computation = await this.computeClassification({
        userId,
        message,
        modelBudget: 'reserve',
      });
      if (computation.kind !== 'computed') {
        await this.releaseClaim({ userId, messageId, previousStatus });
        return this.classificationResult(computation);
      }
      const isHoldout =
        partitionEmailDatasetItem(userId, message.id) === 'HOLDOUT';
      await this.persistClassification({
        userId,
        message,
        classification: computation.classification,
        method: computation.method,
        provider: computation.provider,
        model: computation.model,
        auditSample: computation.auditSample,
        matches: computation.matches,
        verifiedSender: computation.verifiedSender,
        isHoldout,
        reviewConfidenceThreshold: isHoldout
          ? EMAIL_REVIEW_CONFIDENCE_THRESHOLD
          : reviewSettings.reviewConfidenceThreshold,
        acceptVerifiedSenders: reviewSettings.acceptVerifiedSenders,
        replaceExisting: true,
      });
      return this.classificationResult(computation);
    } catch (error) {
      this.logger.warn(
        `Email reclassification failed for message ${messageId}: ${this.safeErrorDescription(error)}`,
      );
      await this.persistFailure(userId, messageId);
      return { kind: 'unavailable', reason: this.safeErrorCode(error) };
    }
  }

  /** Lectura pura de la decisión: solo escribe el contador del minuto. */
  private async computeClassification({
    userId,
    message,
    modelBudget,
    onModelCall,
    recordTelemetry,
  }: {
    userId: string;
    message: ClassifiableMessage;
    modelBudget: ModelBudget;
    onModelCall?: () => void;
    recordTelemetry?: boolean;
  }): Promise<ComputedClassification> {
    if (!(await this.budget.reserveClassificationSlot(userId))) {
      return { kind: 'rate_limited' };
    }
    const resolvedKnowledge = await this.knowledge.resolve(userId, message);
    const matches = resolvedKnowledge.matches;
    const known = matches[0];
    const knownLabel = readKnowledgeLabel(known?.payload);
    const isKnownIrrelevant = knownLabel?.relevance === false;
    let auditSample = false;
    if (isKnownIrrelevant) {
      const [role, consent] = await Promise.all([
        this.prisma.userRole.findUnique({
          where: { userId },
          select: { role: true },
        }),
        this.prisma.userAiSettings.findUnique({
          where: { userId },
          select: { contributeToGlobalKnowledge: true },
        }),
      ]);
      auditSample =
        role?.role === 'ADMIN' &&
        (consent?.contributeToGlobalKnowledge ?? true) &&
        isRecallAuditSample(message.id, RECALL_AUDIT_RATE);
    }

    let classification = auditSample
      ? null
      : parseDeterministicEmail({
          subject: message.subject,
          body: message.content?.sanitizedBody ?? '',
          knownLabel,
        });
    let method: ClassificationMethod = knownLabel
      ? 'KNOWLEDGE'
      : 'DETERMINISTIC';
    if (!classification) {
      const bhdFormat = await this.parseBhdFormat({ userId, message });
      if (bhdFormat) {
        classification = bhdFormat;
        method = 'DETERMINISTIC';
      }
    }
    let provider: string | null = null;
    let model: string | null = null;
    // En la muestra de auditoría el modelo solo mide: si el texto ya fijó la
    // clasificación, la llamada no puede cambiarla ni impedir que se guarde.
    // La medición respeta el filtro de remitentes bancarios del piloto.
    if (
      auditSample &&
      classification &&
      isBankSenderDomain(message.fromDomain, this.limits.bankSenderDomains)
    ) {
      await this.measureWithModel({
        userId,
        message,
        modelBudget,
        recordTelemetry,
        onModelCall,
      });
    }
    if (!classification) {
      if (
        !isBankSenderDomain(message.fromDomain, this.limits.bankSenderDomains)
      ) {
        await this.discardMessage(userId, message.id);
        return { kind: 'no_classification' };
      }
      const content = this.modelContent(message);
      const budget = await this.budget.acquireModelBudget({
        userId,
        modelBudget,
        contentChars: content.length,
      });
      if (!budget) {
        return { kind: 'budget_exhausted' };
      }
      const inferred = await this.classifyWithModelAndSettleCost({
        userId,
        message,
        content,
        budget,
        recordTelemetry,
        onModelCall,
      });
      classification = validateModelClassification(inferred.value);
      method = 'MODEL';
      provider = inferred.provider;
      model = inferred.model;
    }

    if (!classification) {
      return { kind: 'no_classification' };
    }
    const body = message.content?.sanitizedBody ?? '';
    const grounded = groundClassificationCurrency({
      classification: groundBhdClassification({
        classification,
        fromDomain: message.fromDomain,
        subject: message.subject,
        body,
        receivedAt: message.receivedAt,
      }),
      subject: message.subject,
      body,
    });
    const accountGrounded =
      method === 'MODEL'
        ? groundAccountLast4FromText({
            classification: grounded,
            subject: message.subject,
            body,
          })
        : grounded;
    return {
      kind: 'computed',
      classification: withSuggestedTransactionDate({
        classification: accountGrounded,
        receivedAt: message.receivedAt,
      }),
      method,
      provider,
      model,
      auditSample,
      matches,
      verifiedSender: resolvedKnowledge.verifiedSender,
    };
  }

  /**
   * Los formatos fijos BHD se leen del texto y el modelo no se llama. Los
   * productos propios son la única pista que el correo no da completa, así que
   * se piden al dominio dueño.
   */
  private async parseBhdFormat({
    userId,
    message,
  }: {
    userId: string;
    message: ClassifiableMessage;
  }): Promise<EmailClassification | null> {
    if (!isBhdEmail(message.fromDomain)) {
      return null;
    }
    return parseBhdFixedFormat({
      fromDomain: message.fromDomain,
      subject: message.subject,
      body: message.content?.sanitizedBody ?? '',
      receivedAt: message.receivedAt,
      productHints: await this.readProductHints(userId),
    });
  }

  private async readProductHints(
    userId: string,
  ): Promise<EmailProductHints | null> {
    if (!this.productHints) {
      return null;
    }
    return this.productHints.readEmailProductHints(userId);
  }

  /**
   * La muestra de auditoría mide con el modelo sin tocar la clasificación. Un
   * fallo del proveedor o un presupuesto agotado se registran y el resultado
   * sigue siendo el que fijó el texto.
   */
  private async measureWithModel({
    userId,
    message,
    modelBudget,
    recordTelemetry,
    onModelCall,
  }: {
    userId: string;
    message: ClassifiableMessage;
    modelBudget: ModelBudget;
    recordTelemetry?: boolean;
    onModelCall?: () => void;
  }): Promise<void> {
    const content = this.modelContent(message);
    const budget = await this.budget.acquireModelBudget({
      userId,
      modelBudget,
      contentChars: content.length,
    });
    if (!budget) {
      this.logger.warn(
        `Audit sample measurement skipped for message ${message.id}: model budget exhausted`,
      );
      return;
    }
    try {
      await this.classifyWithModelAndSettleCost({
        userId,
        message,
        content,
        budget,
        recordTelemetry,
        onModelCall,
      });
    } catch (error) {
      this.logger.warn(
        `Audit sample measurement failed for message ${message.id}: ${this.safeErrorDescription(error)}`,
      );
    }
  }

  /**
   * Clasifica con el modelo y ajusta la reserva del día al consumo real. Se
   * llama solo después de `acquireModelBudget`, así que siempre hay reserva.
   */
  private async classifyWithModelAndSettleCost({
    userId,
    message,
    content,
    budget,
    recordTelemetry,
    onModelCall,
  }: {
    userId: string;
    message: ClassifiableMessage;
    content: string;
    budget: ModelBudgetGrant;
    recordTelemetry?: boolean;
    onModelCall?: () => void;
  }): Promise<StructuredInference<EmailClassification>> {
    const { inferred, repaired, rejectedCostUsd, rejectedTokens } =
      await classifyEmailWithModel({
        inference: this.inference,
        limits: this.limits,
        logger: this.logger,
        userId,
        message,
        content,
        recordTelemetry,
        onModelCall,
      });
    const costUsd = repaired
      ? sumKnownCosts(rejectedCostUsd, inferred.costUsd)
      : inferred.costUsd;
    if (costUsd != null) {
      await this.dailyLimits.settleCost({ date: budget.costDate, costUsd });
    }
    const usedTokens = repaired
      ? sumKnownTokens(rejectedTokens, inferenceTokens(inferred))
      : inferenceTokens(inferred);
    if (usedTokens != null && budget.reservedTokens != null) {
      await this.dailyLimits.settleTokens({
        userId,
        date: budget.costDate,
        reservedTokens: budget.reservedTokens,
        usedTokens,
      });
    }
    return inferred;
  }

  private classificationResult(
    computation: ComputedClassification,
  ): MessageClassificationResult {
    if (computation.kind !== 'computed') {
      return {
        kind: 'unavailable',
        reason:
          computation.kind === 'budget_exhausted'
            ? 'MODEL_BUDGET_EXHAUSTED'
            : computation.kind === 'rate_limited'
              ? 'RATE_LIMITED'
              : 'CLASSIFICATION_UNAVAILABLE',
      };
    }
    return {
      kind: 'classified',
      classification: computation.classification,
      method: computation.method,
      provider: computation.provider,
      model: computation.model,
      auditSample: computation.auditSample,
      knowledgeUsed: computation.matches.map(
        ({ knowledgeType, knowledgeKey, scope }) => ({
          knowledgeType,
          knowledgeKey,
          scope,
        }),
      ),
    };
  }

  private async claimForReclassification({
    userId,
    messageId,
  }: {
    userId: string;
    messageId: string;
  }): Promise<void> {
    await this.prisma.aiEmailMessage.updateMany({
      where: { id: messageId, userId },
      data: {
        processingStatus: 'CLASSIFYING',
        classificationStartedAt: new Date(),
      },
    });
  }

  private async releaseClaim({
    userId,
    messageId,
    previousStatus,
  }: {
    userId: string;
    messageId: string;
    previousStatus: string;
  }): Promise<void> {
    await this.prisma.aiEmailMessage.updateMany({
      where: { id: messageId, userId, processingStatus: 'CLASSIFYING' },
      data: {
        processingStatus: previousStatus as 'PROCESSED',
        classificationStartedAt: null,
      },
    });
  }

  private async persistClassification(input: {
    userId: string;
    message: ClassifiableMessage;
    classification: EmailClassification;
    method: ClassificationMethod;
    provider: string | null;
    model: string | null;
    auditSample: boolean;
    matches: KnowledgeMatch[];
    reviewConfidenceThreshold: number;
    isHoldout: boolean;
    verifiedSender: boolean;
    acceptVerifiedSenders: boolean;
    replaceExisting?: boolean;
  }) {
    const dataset = await this.prisma.aiDataset.upsert({
      where: { name: EMAIL_DATASET_NAME },
      create: {
        name: EMAIL_DATASET_NAME,
        purpose: EMAIL_DATASET_PURPOSE,
        sourceType: 'EMAIL',
      },
      update: {},
      select: { id: true },
    });
    const partition = partitionEmailDatasetItem(input.userId, input.message.id);
    await this.prisma.aiDatasetItem.upsert({
      where: {
        datasetId_sourceType_sourceId: {
          datasetId: dataset.id,
          sourceType: 'EMAIL_MESSAGE',
          sourceId: input.message.id,
        },
      },
      create: {
        datasetId: dataset.id,
        userId: input.userId,
        sourceType: 'EMAIL_MESSAGE',
        sourceId: input.message.id,
        partition,
      },
      update: {},
    });
    const [observationWatermark, verificationWatermark, consentWatermark] =
      await Promise.all([
        this.prisma.aiKnowledgeObservation.aggregate({
          _max: { sequence: true },
        }),
        this.prisma.aiHumanVerification.aggregate({ _max: { sequence: true } }),
        this.prisma.aiConsentEvent.aggregate({
          where: { userId: input.userId },
          _max: { sequence: true },
        }),
      ]);
    const run = await this.prisma.aiAnalysisRun.create({
      data: {
        userId: input.userId,
        datasetId: dataset.id,
        mode: 'ANALYZE_ONLY',
        status: 'RUNNING',
        observationSequence: observationWatermark._max.sequence ?? 0n,
        verificationSequence: verificationWatermark._max.sequence ?? 0n,
        consentRevision: consentWatermark._max.sequence ?? 0n,
        projectorVersion: PROJECTOR_VERSION,
        policyVersion: POLICY_VERSION,
        pipelineVersion: EMAIL_CLASSIFICATION_VERSIONS.pipeline,
        detectorVersion: EMAIL_CLASSIFICATION_VERSIONS.detector,
        promptVersion: EMAIL_CLASSIFICATION_VERSIONS.prompt,
        schemaVersion: EMAIL_CLASSIFICATION_VERSIONS.schema,
        configuration: {
          parserVersion: EMAIL_CLASSIFICATION_VERSIONS.parser,
          reviewConfidenceThreshold: input.reviewConfidenceThreshold,
          auditSample: input.auditSample,
        },
      },
      select: { id: true },
    });

    const routes: Array<string | null> = input.classification.routes.length
      ? input.classification.routes
      : [null];
    const provenance: ClassificationProvenance = {
      method: input.method,
      provider: input.provider,
      model: input.model,
      auditSample: input.auditSample,
      matches: input.matches,
    };
    const label = classificationLabel(input.classification);
    const knowledgeUsed = knowledgeUsedRefs(input.matches);
    const observationRows = routes.map((route) => ({
      runId: run.id,
      userId: input.userId,
      knowledgeType: 'EMAIL_CLASSIFICATION',
      knowledgeKey: `${input.message.id}:${route ?? 'NONE'}`,
      proposedScope: 'USER',
      sourceType: 'EMAIL_MESSAGE',
      sourceId: input.message.id,
      normalizerVersion: NORMALIZER_VERSION,
      derivedFromKnowledgeIds: input.matches.map(({ id }) => id),
      payload: {
        route,
        label: { ...label, routes: route ? [route] : [] },
        confidence: input.classification.confidence,
        method: input.method,
        knowledgeUsed,
        provider: input.provider,
        model: input.model,
        auditSample: input.auditSample,
      } satisfies Prisma.InputJsonValue,
    }));
    const reviewRequired = requiresReview({
      classification: input.classification,
      auditSample: input.auditSample,
      reviewConfidenceThreshold: input.reviewConfidenceThreshold,
      isHoldout: input.isHoldout,
      verifiedSender: input.verifiedSender,
      acceptVerifiedSenders: input.acceptVerifiedSenders,
    });
    const signalWrites = buildFinanceSignal({
      userId: input.userId,
      messageId: input.message.id,
      receivedAt: input.message.receivedAt,
      classification: input.classification,
      provenance,
    });
    await this.prisma.$transaction([
      ...(input.replaceExisting
        ? [
            this.prisma.aiEmailClassification.deleteMany({
              where: { userId: input.userId, messageId: input.message.id },
            }),
          ]
        : []),
      this.prisma.aiEmailClassification.createMany({
        data: buildClassificationRows({
          userId: input.userId,
          messageId: input.message.id,
          classification: input.classification,
          provenance,
        }),
      }),
      this.prisma.aiKnowledgeObservation.createMany({ data: observationRows }),
      this.prisma.aiAnalysisRun.update({
        where: { id: run.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          metrics: {
            observations: routes.length,
            requiresReview: reviewRequired,
          },
        },
      }),
      this.prisma.aiEmailMessage.updateMany({
        where: {
          id: input.message.id,
          userId: input.userId,
          processingStatus: 'CLASSIFYING',
        },
        data: {
          processingStatus: reviewRequired ? 'REVIEW_REQUIRED' : 'PROCESSED',
          classificationStartedAt: null,
          classification: {
            relevance: input.classification.relevance,
            semanticType: input.classification.semanticType,
            routes: input.classification.routes,
            ...(input.classification.transaction
              ? { transaction: input.classification.transaction }
              : {}),
            confidence: input.classification.confidence,
          },
          classificationPath: input.method,
          classificationProvider: input.provider,
          classificationModel: input.model,
        },
      }),
      ...(signalWrites
        ? [
            this.prisma.aiSignal.createMany({
              data: [signalWrites.signal],
              skipDuplicates: true,
            }),
            this.prisma.aiSignalEvidence.createMany({
              data: [signalWrites.evidence],
              skipDuplicates: true,
            }),
            this.prisma.domainEventOutbox.createMany({
              data: [signalWrites.outbox],
              skipDuplicates: true,
            }),
          ]
        : []),
    ]);
  }

  /**
   * Fuera del piloto: el remitente no es bancario y el texto no alcanzó para una
   * clasificación determinista. Se descarta en vez de mandarlo a revisión.
   */
  private async discardMessage(userId: string, messageId: string) {
    await this.prisma.aiEmailMessage.updateMany({
      where: { id: messageId, userId, processingStatus: 'CLASSIFYING' },
      data: {
        processingStatus: 'DISCARDED',
        classificationStartedAt: null,
      },
    });
    this.logger.debug(
      `Message ${messageId} discarded: sender outside the bank list`,
    );
  }

  private async persistFailure(userId: string, messageId: string) {
    await this.prisma.aiEmailMessage.updateMany({
      where: { id: messageId, userId, processingStatus: 'CLASSIFYING' },
      data: {
        processingStatus: 'REVIEW_REQUIRED',
        classificationStartedAt: null,
      },
    });
    this.logger.debug(`Message ${messageId} requires classification review`);
  }

  private async leaveQueued(messageId: string, userId: string) {
    await this.prisma.aiEmailMessage.updateMany({
      where: { id: messageId, userId, processingStatus: 'CLASSIFYING' },
      data: { processingStatus: 'QUEUED', classificationStartedAt: null },
    });
  }

  /** El contenido que ve el modelo, recortado al máximo configurado. */
  private modelContent(message: ClassifiableMessage): string {
    return (message.content?.sanitizedBody ?? '').slice(
      0,
      this.limits.maxContentChars,
    );
  }

  private safeErrorDescription(error: unknown) {
    const code = this.safeErrorCode(error);
    if (error instanceof StructuredInferenceOutputError && error.detail) {
      return `${code} (${error.detail})`;
    }
    return code;
  }

  private safeErrorCode(error: unknown) {
    if (error && typeof error === 'object' && 'code' in error) {
      return String(error.code).slice(0, 80);
    }
    return 'CLASSIFICATION_FAILED';
  }
}
