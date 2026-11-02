import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';
import {
  createScriptPrismaClient,
  Prisma,
  type PrismaService,
} from '../../packages/database/dist';
import { AiKnowledgeService } from '../../packages/ai-agent/dist/intelligence/knowledge/ai-knowledge.service';
import {
  isSafeGlobalTemplateKey,
  knowledgeKeys,
  NORMALIZER_VERSION,
} from '../../packages/ai-agent/dist/intelligence/knowledge/knowledge-normalizer';
import {
  parseUserEmailPayload,
  type EmailLabel,
} from '../../packages/ai-agent/dist/intelligence/knowledge/knowledge-payload';
import {
  EMAIL_DATASET_NAME,
  EMAIL_DATASET_PURPOSE,
} from '../../packages/ai-agent/dist/intelligence/evidence/dataset.constants';
import { SeedGuardError } from './dev-seed-guard';
import { seedUuid } from './seed-fixtures';

const KNOWLEDGE_MIGRATION = '20261101090009_ai_knowledge';
const EMAIL_SOURCE_TYPE = 'EMAIL_MESSAGE';
const KNOWLEDGE_TARGET_TYPE = 'KNOWLEDGE';
const DATASET_PARTITION = 'TRAIN' as const;
const SEED_CONSENT_REASON = 'QA_SEED';
const SEED_REJECTION_NOTE = 'Dato sintético del seed de QA';
const SEED_PLACEHOLDER_TOKEN = 'qa-seed-placeholder-not-a-token';
const REVERSION_CREATED_AT = new Date('2026-10-26T12:30:00.000Z');

type SeedPrisma = ReturnType<typeof createScriptPrismaClient>;
type TransactionClient = Prisma.TransactionClient;

export type EvidenceUserRole = 'USER' | 'CONTRIBUTOR' | 'ADMIN';
export type EvidenceKnowledgeType =
  'EMAIL_SENDER' | 'EMAIL_DOMAIN' | 'EMAIL_TEMPLATE';
export type GlobalState = 'STABLE' | 'REVIEW_REQUIRED' | 'BLOCKED';

export type EvidenceUser = {
  id: string;
  email: string;
  role: EvidenceUserRole;
};

export type EvidenceMessage = {
  key: string;
  userId: string;
  fromAddress: string;
  subject: string;
  receivedAt: Date;
  globalState?: GlobalState;
};

export type EvidenceVerification = {
  messageKey: string;
  userId: string;
  verdict: 'CONFIRMED' | 'CORRECTED' | 'REJECTED';
  label?: EmailLabel;
  notes?: string;
  createdAt: Date;
};

export type EvidenceObservation = {
  messageKey: string;
  userId: string;
  knowledgeType: EvidenceKnowledgeType;
  label: EmailLabel;
  createdAt: Date;
};

export type KnowledgeEvidenceInput = {
  seedVersion: string;
  users: readonly EvidenceUser[];
  messages: readonly EvidenceMessage[];
  verifications: readonly EvidenceVerification[];
  observations?: readonly EvidenceObservation[];
  summaryUserId: string;
  requesterId: string;
};

export type EvidenceCounts = {
  messagesCreated: number;
  messagesUpdated: number;
  verificationsCreated: number;
  verificationsSkipped: number;
  observationsCreated: number;
  observationsSkipped: number;
  reversalsCreated: number;
  reversalsSkipped: number;
  connectionsCreated: number;
  datasetItemsCreated: number;
  consentEventsCreated: number;
};

export type ProjectionSummary = {
  personal: Record<string, number>;
  global: Record<string, number>;
};

export type KnowledgeEvidenceResult = {
  evidence: EvidenceCounts;
  rebuild: { runId: string; items: number };
  projection: ProjectionSummary;
};

export type EvidencePlan = {
  messages: number;
  verifications: number;
  observations: number;
  globalKeys: number;
  personalStates: string[];
  globalStates: string[];
};

type KnowledgeKey = {
  knowledgeType: EvidenceKnowledgeType;
  knowledgeKey: string;
};

type MessagePlan = {
  fixture: EvidenceMessage;
  id: string;
  providerMessageId: string;
  keys: KnowledgeKey[];
};

type GlobalTarget = KnowledgeKey & {
  state: GlobalState;
};

type PreparedEvidence = {
  messagePlans: MessagePlan[];
  messageByFixtureKey: Map<string, MessagePlan>;
  userById: Map<string, EvidenceUser>;
  personalKeys: string[];
  globalKeys: string[];
  globalTargets: Map<string, GlobalTarget>;
  expectedPersonalStates: string[];
  expectedGlobalStates: GlobalState[];
  summaryUserId: string;
  requesterId: string;
};

type ReversionRef = {
  knowledgeType: 'EMAIL_DOMAIN' | 'EMAIL_TEMPLATE';
  knowledgeKey: string;
};

type ReversionResult = {
  created: number;
  skipped: number;
};

function toMessagePlan(
  message: EvidenceMessage,
  seedVersion: string,
): MessagePlan {
  const keys = knowledgeKeys(message.fromAddress, message.subject);
  if (keys.length === 0) {
    throw new SeedGuardError(
      `El mensaje ${message.key} no produce claves de conocimiento`,
    );
  }
  return {
    fixture: message,
    id: seedUuid({
      seedVersion,
      scope: 'EVIDENCE',
      type: 'EMAIL_MESSAGE',
      key: message.key,
      userId: message.userId,
    }),
    providerMessageId: `${seedVersion}:${message.key}`,
    keys,
  };
}

function latestVerificationByMessage(
  verifications: readonly EvidenceVerification[],
): Map<string, EvidenceVerification> {
  const latest = new Map<string, EvidenceVerification>();
  for (const verification of verifications) {
    latest.set(verification.messageKey, verification);
  }
  return latest;
}

function assertValidUserLabel({
  label,
  source,
}: {
  label: EmailLabel;
  source: string;
}): void {
  try {
    parseUserEmailPayload({ label });
  } catch (error) {
    throw new SeedGuardError(`Etiqueta inválida en ${source}`, {
      cause: error,
    });
  }
}

function prepareEvidence(input: KnowledgeEvidenceInput): PreparedEvidence {
  const userById = new Map(input.users.map((user) => [user.id, user]));
  if (userById.size !== input.users.length) {
    throw new SeedGuardError('El seed repite usuarios');
  }
  const summaryUser = userById.get(input.summaryUserId);
  if (!summaryUser) {
    throw new SeedGuardError('El usuario de resumen no está en el seed');
  }
  const requester = userById.get(input.requesterId);
  if (!requester) {
    throw new SeedGuardError('El usuario que reconstruye no está en el seed');
  }
  if (requester.role !== 'ADMIN') {
    throw new SeedGuardError('El usuario que reconstruye debe ser ADMIN');
  }

  const messagePlans = input.messages.map((message) =>
    toMessagePlan(message, input.seedVersion),
  );
  const messageByFixtureKey = new Map<string, MessagePlan>();
  for (const plan of messagePlans) {
    if (messageByFixtureKey.has(plan.fixture.key)) {
      throw new SeedGuardError(`El seed repite el mensaje ${plan.fixture.key}`);
    }
    if (!userById.has(plan.fixture.userId)) {
      throw new SeedGuardError(
        `El mensaje ${plan.fixture.key} no tiene usuario en el seed`,
      );
    }
    messageByFixtureKey.set(plan.fixture.key, plan);
  }

  const latestVerification = latestVerificationByMessage(input.verifications);
  for (const verification of input.verifications) {
    const plan = messageByFixtureKey.get(verification.messageKey);
    if (!plan) {
      throw new SeedGuardError(
        `La verificación apunta a ${verification.messageKey}, que no existe`,
      );
    }
    if (verification.userId !== plan.fixture.userId) {
      throw new SeedGuardError(
        `La verificación de ${verification.messageKey} no pertenece al dueño`,
      );
    }
    if (verification.verdict !== 'REJECTED') {
      if (!verification.label) {
        throw new SeedGuardError(
          `La verificación de ${verification.messageKey} necesita etiqueta`,
        );
      }
      assertValidUserLabel({
        label: verification.label,
        source: `verificación de ${verification.messageKey}`,
      });
    }
  }

  for (const observation of input.observations ?? []) {
    const plan = messageByFixtureKey.get(observation.messageKey);
    if (!plan) {
      throw new SeedGuardError(
        `La observación apunta a ${observation.messageKey}, que no existe`,
      );
    }
    if (observation.userId !== plan.fixture.userId) {
      throw new SeedGuardError(
        `La observación de ${observation.messageKey} no pertenece al dueño`,
      );
    }
    if (
      !plan.keys.some((key) => key.knowledgeType === observation.knowledgeType)
    ) {
      throw new SeedGuardError(
        `La observación de ${observation.messageKey} no coincide con una clave`,
      );
    }
    if (latestVerification.has(observation.messageKey)) {
      throw new SeedGuardError(
        `La observación de ${observation.messageKey} compite con una verificación`,
      );
    }
    assertValidUserLabel({
      label: observation.label,
      source: `observación de ${observation.messageKey}`,
    });
  }

  const globalTargets = new Map<string, GlobalTarget>();
  for (const plan of messagePlans) {
    const state = plan.fixture.globalState;
    const latest = latestVerification.get(plan.fixture.key);
    if (!state) {
      if (latest && latest.verdict !== 'REJECTED') {
        throw new SeedGuardError(
          `El mensaje verificado ${plan.fixture.key} necesita globalState`,
        );
      }
      continue;
    }
    if (!latest || latest.verdict === 'REJECTED') {
      throw new SeedGuardError(
        `El mensaje ${plan.fixture.key} no tiene evidencia para globalState`,
      );
    }
    for (const key of plan.keys) {
      if (key.knowledgeType === 'EMAIL_SENDER') {
        continue;
      }
      if (
        key.knowledgeType === 'EMAIL_TEMPLATE' &&
        !isSafeGlobalTemplateKey(key.knowledgeKey)
      ) {
        continue;
      }
      const targetKey = `${key.knowledgeType}|${key.knowledgeKey}`;
      const previous = globalTargets.get(targetKey);
      if (previous && previous.state !== state) {
        throw new SeedGuardError(`El seed pide dos estados para ${targetKey}`);
      }
      globalTargets.set(targetKey, { ...key, state });
    }
  }

  const personalKeys = [
    ...new Set(
      messagePlans
        .filter((plan) => plan.fixture.userId === input.summaryUserId)
        .flatMap((plan) => plan.keys.map((key) => key.knowledgeKey)),
    ),
  ];
  const personalStates: string[] = [];
  if (
    input.verifications.some(
      (verification) =>
        verification.userId === input.summaryUserId &&
        verification.verdict !== 'REJECTED',
    )
  ) {
    personalStates.push('STABLE');
  }
  if (
    (input.observations ?? []).some(
      (observation) => observation.userId === input.summaryUserId,
    )
  ) {
    personalStates.push('OBSERVED');
  }

  return {
    messagePlans,
    messageByFixtureKey,
    userById,
    personalKeys,
    globalKeys: [
      ...new Set(
        [...globalTargets.values()].map((target) => target.knowledgeKey),
      ),
    ],
    globalTargets,
    expectedPersonalStates: personalStates,
    expectedGlobalStates: [
      ...new Set([...globalTargets.values()].map((target) => target.state)),
    ],
    summaryUserId: input.summaryUserId,
    requesterId: input.requesterId,
  };
}

export function describeKnowledgeEvidence(
  input: KnowledgeEvidenceInput,
): EvidencePlan {
  const prepared = prepareEvidence(input);
  return {
    messages: prepared.messagePlans.length,
    verifications: input.verifications.length,
    observations: input.observations?.length ?? 0,
    globalKeys: prepared.globalTargets.size,
    personalStates: prepared.expectedPersonalStates,
    globalStates: prepared.expectedGlobalStates,
  };
}

export async function assertKnowledgeMigration(
  prisma: SeedPrisma,
): Promise<void> {
  const migration = await prisma.$queryRaw<
    Array<{ finished_at: Date | null; rolled_back_at: Date | null }>
  >`SELECT finished_at, rolled_back_at FROM "_prisma_migrations" WHERE migration_name = ${KNOWLEDGE_MIGRATION} ORDER BY started_at DESC LIMIT 1`;
  if (!migration[0]?.finished_at || migration[0].rolled_back_at) {
    throw new SeedGuardError(
      'La migración de Knowledge no está aplicada en DEV',
    );
  }
}

/** Asegura el ADMIN de DEV que reconstruye Knowledge. */
export async function ensureAdminRole({
  prisma,
  email,
}: {
  prisma: SeedPrisma;
  email: string;
}): Promise<{ id: string }> {
  const admin = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (!admin) {
    throw new SeedGuardError(`No existe la cuenta ${email} en DEV`);
  }
  await prisma.userRole.upsert({
    where: { userId: admin.id },
    create: { userId: admin.id, role: 'ADMIN' },
    update: { role: 'ADMIN' },
  });
  return admin;
}

async function ensureConnection(
  tx: TransactionClient,
  user: EvidenceUser,
): Promise<{ id: string; created: boolean }> {
  const existing = await tx.aiEmailConnection.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  if (existing) {
    return { id: existing.id, created: false };
  }
  const connection = await tx.aiEmailConnection.create({
    data: {
      userId: user.id,
      emailAddress: user.email,
      isActive: false,
      accessTokenEncrypted: SEED_PLACEHOLDER_TOKEN,
    },
    select: { id: true },
  });
  return { id: connection.id, created: true };
}

async function ensureConsent(
  tx: TransactionClient,
  userId: string,
): Promise<boolean> {
  await tx.userAiSettings.upsert({
    where: { userId },
    create: { userId, contributeToGlobalKnowledge: true },
    update: { contributeToGlobalKnowledge: true },
  });
  const latest = await tx.aiConsentEvent.findFirst({
    where: { userId },
    orderBy: { sequence: 'desc' },
    select: { contributeToGlobalKnowledge: true },
  });
  if (latest?.contributeToGlobalKnowledge === true) {
    return false;
  }
  await tx.aiConsentEvent.create({
    data: {
      userId,
      contributeToGlobalKnowledge: true,
      reason: SEED_CONSENT_REASON,
    },
  });
  return true;
}

async function upsertMessage(
  tx: TransactionClient,
  plan: MessagePlan,
  connectionId: string,
): Promise<boolean> {
  const domain = plan.keys.find(
    (key) => key.knowledgeType === 'EMAIL_DOMAIN',
  )?.knowledgeKey;
  const template = plan.keys.find(
    (key) => key.knowledgeType === 'EMAIL_TEMPLATE',
  )?.knowledgeKey;
  if (!domain) {
    throw new SeedGuardError(`El mensaje ${plan.fixture.key} no tiene dominio`);
  }
  const messageData = {
    userId: plan.fixture.userId,
    connectionId,
    providerMessageId: plan.providerMessageId,
    receivedAt: plan.fixture.receivedAt,
    fromAddress: plan.fixture.fromAddress,
    fromDomain: domain,
    subject: plan.fixture.subject,
    contentFingerprint: createHash('sha256')
      .update(
        `${plan.fixture.key}|${plan.fixture.fromAddress}|${plan.fixture.subject}`,
      )
      .digest('hex'),
    templateFingerprint: template
      ? createHash('sha256').update(template).digest('hex')
      : null,
    processingStatus: 'PROCESSED' as const,
    createdAt: plan.fixture.receivedAt,
  };
  const existing = await tx.aiEmailMessage.findUnique({
    where: { id: plan.id },
    select: { id: true },
  });
  if (existing) {
    await tx.aiEmailMessage.update({
      where: { id: plan.id },
      data: messageData,
    });
    return false;
  }
  await tx.aiEmailMessage.create({ data: { id: plan.id, ...messageData } });
  return true;
}

async function ensureDatasetItem(
  tx: TransactionClient,
  datasetId: string,
  plan: MessagePlan,
): Promise<boolean> {
  const existing = await tx.aiDatasetItem.findUnique({
    where: {
      datasetId_sourceType_sourceId: {
        datasetId,
        sourceType: EMAIL_SOURCE_TYPE,
        sourceId: plan.id,
      },
    },
    select: { id: true, partition: true },
  });
  if (existing) {
    if (existing.partition !== DATASET_PARTITION) {
      await tx.aiDatasetItem.update({
        where: { id: existing.id },
        data: { partition: DATASET_PARTITION },
      });
    }
    return false;
  }
  await tx.aiDatasetItem.create({
    data: {
      datasetId,
      userId: plan.fixture.userId,
      sourceType: EMAIL_SOURCE_TYPE,
      sourceId: plan.id,
      partition: DATASET_PARTITION,
    },
  });
  return true;
}

async function ensureVerification(
  tx: TransactionClient,
  plan: MessagePlan,
  verification: EvidenceVerification,
  user: EvidenceUser,
): Promise<boolean> {
  const label = verification.label;
  const desiredPayload = label ?? null;
  const latest = await tx.aiHumanVerification.findFirst({
    where: {
      userId: verification.userId,
      targetType: EMAIL_SOURCE_TYPE,
      targetId: plan.id,
    },
    orderBy: { sequence: 'desc' },
    select: {
      userId: true,
      verifierRole: true,
      verdict: true,
      correctedPayload: true,
      isGroundTruth: true,
    },
  });
  if (
    latest &&
    latest.userId === verification.userId &&
    latest.verifierRole === user.role &&
    latest.verdict === verification.verdict &&
    latest.isGroundTruth === false &&
    isDeepStrictEqual(latest.correctedPayload, desiredPayload)
  ) {
    return false;
  }
  await tx.aiHumanVerification.create({
    data: {
      userId: verification.userId,
      verifierRole: user.role,
      targetType: EMAIL_SOURCE_TYPE,
      targetId: plan.id,
      verdict: verification.verdict,
      correctedPayload:
        desiredPayload === null ? Prisma.JsonNull : desiredPayload,
      notes:
        verification.notes ??
        (verification.verdict === 'REJECTED' ? SEED_REJECTION_NOTE : null),
      isGroundTruth: false,
      createdAt: verification.createdAt,
    },
  });
  return true;
}

async function ensureObservation(
  tx: TransactionClient,
  plan: MessagePlan,
  observation: EvidenceObservation,
): Promise<boolean> {
  const key = plan.keys.find(
    (candidate) => candidate.knowledgeType === observation.knowledgeType,
  );
  if (!key) {
    throw new SeedGuardError(
      `La observación de ${observation.messageKey} no coincide con una clave`,
    );
  }
  const existing = await tx.aiKnowledgeObservation.findFirst({
    where: {
      userId: observation.userId,
      sourceType: EMAIL_SOURCE_TYPE,
      sourceId: plan.id,
      knowledgeType: key.knowledgeType,
      knowledgeKey: key.knowledgeKey,
      derivedFromKnowledgeIds: { isEmpty: true },
    },
    select: { sequence: true },
  });
  if (existing) {
    return false;
  }
  await tx.aiKnowledgeObservation.create({
    data: {
      userId: observation.userId,
      knowledgeType: key.knowledgeType,
      knowledgeKey: key.knowledgeKey,
      proposedScope: 'USER',
      sourceType: EMAIL_SOURCE_TYPE,
      sourceId: plan.id,
      payload: { label: observation.label },
      derivedFromKnowledgeIds: [],
      weight: 1,
      normalizerVersion: NORMALIZER_VERSION,
      createdAt: observation.createdAt,
    },
  });
  return true;
}

function asReversionRefs(structuralKeysJson: Prisma.JsonValue): ReversionRef[] {
  if (!Array.isArray(structuralKeysJson)) {
    return [];
  }
  return structuralKeysJson.flatMap((candidate) => {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate)
    ) {
      return [];
    }
    const { knowledgeType, knowledgeKey } = candidate as {
      knowledgeType?: unknown;
      knowledgeKey?: unknown;
    };
    if (
      (knowledgeType !== 'EMAIL_DOMAIN' &&
        knowledgeType !== 'EMAIL_TEMPLATE') ||
      typeof knowledgeKey !== 'string'
    ) {
      return [];
    }
    return [{ knowledgeType, knowledgeKey }];
  });
}

async function ensureReversions(
  tx: TransactionClient,
  prepared: PreparedEvidence,
): Promise<ReversionResult> {
  const existing = await tx.aiHumanVerification.findMany({
    where: {
      targetType: KNOWLEDGE_TARGET_TYPE,
      verifierRole: 'ADMIN',
      verdict: { in: ['CONFIRMED', 'REJECTED'] },
    },
    orderBy: { sequence: 'asc' },
    select: { verdict: true, structuralKeys: true },
  });
  const latestVerdict = new Map<string, 'CONFIRMED' | 'REJECTED'>();
  for (const row of existing) {
    if (row.verdict !== 'CONFIRMED' && row.verdict !== 'REJECTED') {
      continue;
    }
    for (const ref of asReversionRefs(row.structuralKeys)) {
      latestVerdict.set(
        `${ref.knowledgeType}|${ref.knowledgeKey}`,
        row.verdict,
      );
    }
  }

  const toConfirm: ReversionRef[] = [];
  const toReject: ReversionRef[] = [];
  let skipped = 0;
  for (const [targetKey, target] of prepared.globalTargets) {
    const ref = {
      knowledgeType: target.knowledgeType as ReversionRef['knowledgeType'],
      knowledgeKey: target.knowledgeKey,
    };
    const latest = latestVerdict.get(targetKey);
    if (target.state === 'BLOCKED' && latest !== 'REJECTED') {
      toReject.push(ref);
      continue;
    }
    if (target.state !== 'BLOCKED' && latest === 'REJECTED') {
      toConfirm.push(ref);
      continue;
    }
    skipped++;
  }

  let created = 0;
  for (const [verdict, refs] of [
    ['CONFIRMED', toConfirm],
    ['REJECTED', toReject],
  ] as const) {
    if (refs.length === 0) {
      continue;
    }
    await tx.aiHumanVerification.create({
      data: {
        userId: prepared.requesterId,
        verifierRole: 'ADMIN',
        targetType: KNOWLEDGE_TARGET_TYPE,
        targetId: null,
        verdict,
        structuralKeys: refs as unknown as Prisma.InputJsonValue,
        notes:
          verdict === 'REJECTED'
            ? 'Seed QA: bloquea claves sintéticas'
            : 'Seed QA: restaura claves sintéticas',
        normalizerVersion: NORMALIZER_VERSION,
        createdAt: REVERSION_CREATED_AT,
      },
    });
    created++;
  }
  return { created, skipped };
}

function emptyCounts(): EvidenceCounts {
  return {
    messagesCreated: 0,
    messagesUpdated: 0,
    verificationsCreated: 0,
    verificationsSkipped: 0,
    observationsCreated: 0,
    observationsSkipped: 0,
    reversalsCreated: 0,
    reversalsSkipped: 0,
    connectionsCreated: 0,
    datasetItemsCreated: 0,
    consentEventsCreated: 0,
  };
}

async function rebuildKnowledge({
  prisma,
  requesterId,
}: {
  prisma: SeedPrisma;
  requesterId: string;
}) {
  const rawMinimumContributors = process.env.AI_GLOBAL_MIN_CONTRIBUTORS?.trim();
  const minimumContributors = rawMinimumContributors
    ? Number(rawMinimumContributors)
    : undefined;
  if (
    rawMinimumContributors &&
    (!Number.isInteger(minimumContributors) || (minimumContributors ?? 0) < 1)
  ) {
    throw new SeedGuardError('AI_GLOBAL_MIN_CONTRIBUTORS no es válido');
  }
  const config = new ConfigService({
    NODE_ENV: process.env.NODE_ENV,
    ...(minimumContributors === undefined
      ? {}
      : { AI_GLOBAL_MIN_CONTRIBUTORS: minimumContributors }),
  }) as unknown as ConfigService<Env, true>;
  const knowledge = new AiKnowledgeService(
    prisma as unknown as PrismaService,
    config,
  );
  return knowledge.rebuild(requesterId);
}

type SummaryRow = {
  knowledgeType: string;
  knowledgeKey: string;
  state: string;
  messagesSeen: number;
};

async function summarizeProjection({
  prisma,
  prepared,
}: {
  prisma: SeedPrisma;
  prepared: PreparedEvidence;
}) {
  const [personalRows, globalRows] = await Promise.all([
    prisma.aiKnowledge.findMany({
      where: {
        scope: 'USER',
        userId: prepared.summaryUserId,
        knowledgeKey: { in: prepared.personalKeys },
      },
      select: {
        knowledgeType: true,
        knowledgeKey: true,
        state: true,
        messagesSeen: true,
      },
    }),
    prisma.aiKnowledge.findMany({
      where: {
        scope: 'GLOBAL',
        knowledgeKey: { in: prepared.globalKeys },
      },
      select: {
        knowledgeType: true,
        knowledgeKey: true,
        state: true,
        messagesSeen: true,
      },
    }),
  ]);
  return { personalRows, globalRows };
}

function countStates(
  rows: readonly SummaryRow[],
  scope: 'USER' | 'GLOBAL',
): Record<string, number> {
  return rows.reduce<Record<string, number>>((summary, row) => {
    const key = `${scope}/${row.state}`;
    summary[key] = (summary[key] ?? 0) + 1;
    return summary;
  }, {});
}

function assertProjectionSummary({
  prepared,
  personalRows,
  globalRows,
  summary,
}: {
  prepared: PreparedEvidence;
  personalRows: readonly SummaryRow[];
  globalRows: readonly SummaryRow[];
  summary: ProjectionSummary;
}): void {
  for (const state of prepared.expectedPersonalStates) {
    if (!summary.personal[`USER/${state}`]) {
      throw new SeedGuardError(`La proyección no mantuvo USER/${state}`);
    }
  }
  for (const state of prepared.expectedGlobalStates) {
    if (!summary.global[`GLOBAL/${state}`]) {
      throw new SeedGuardError(`La proyección no mantuvo GLOBAL/${state}`);
    }
  }
  for (const target of prepared.globalTargets.values()) {
    const row = globalRows.find(
      (candidate) =>
        candidate.knowledgeType === target.knowledgeType &&
        candidate.knowledgeKey === target.knowledgeKey,
    );
    if (!row) {
      throw new SeedGuardError(
        `Falta la fila GLOBAL ${target.knowledgeType}/${target.knowledgeKey}`,
      );
    }
    if (row.messagesSeen === 0) {
      throw new SeedGuardError(
        `La fila GLOBAL ${target.knowledgeType}/${target.knowledgeKey} no tiene evidencia`,
      );
    }
  }
  for (const row of personalRows) {
    if (row.messagesSeen === 0) {
      throw new SeedGuardError(
        `La fila USER ${row.knowledgeKey} no tiene evidencia`,
      );
    }
  }
}

export async function seedKnowledgeEvidence({
  prisma,
  input,
}: {
  prisma: SeedPrisma;
  input: KnowledgeEvidenceInput;
}): Promise<KnowledgeEvidenceResult> {
  await assertKnowledgeMigration(prisma);
  const prepared = prepareEvidence(input);
  const counts = emptyCounts();

  await prisma.$transaction(
    async (tx) => {
      const connectionByUserId = new Map<string, string>();
      for (const user of prepared.userById.values()) {
        const connection = await ensureConnection(tx, user);
        connectionByUserId.set(user.id, connection.id);
        if (connection.created) {
          counts.connectionsCreated++;
        }
        if (await ensureConsent(tx, user.id)) {
          counts.consentEventsCreated++;
        }
      }

      const dataset = await tx.aiDataset.upsert({
        where: { name: EMAIL_DATASET_NAME },
        create: {
          name: EMAIL_DATASET_NAME,
          purpose: EMAIL_DATASET_PURPOSE,
        },
        update: {},
        select: { id: true },
      });
      for (const plan of prepared.messagePlans) {
        const connectionId = connectionByUserId.get(plan.fixture.userId);
        if (!connectionId) {
          throw new SeedGuardError(
            `El mensaje ${plan.fixture.key} no tiene conexión de correo`,
          );
        }
        if (await upsertMessage(tx, plan, connectionId)) {
          counts.messagesCreated++;
        } else {
          counts.messagesUpdated++;
        }
        if (await ensureDatasetItem(tx, dataset.id, plan)) {
          counts.datasetItemsCreated++;
        }
      }

      for (const verification of input.verifications) {
        const plan = prepared.messageByFixtureKey.get(verification.messageKey);
        const user = prepared.userById.get(verification.userId);
        if (!plan || !user) {
          throw new SeedGuardError(
            `La verificación de ${verification.messageKey} no está completa`,
          );
        }
        if (await ensureVerification(tx, plan, verification, user)) {
          counts.verificationsCreated++;
        } else {
          counts.verificationsSkipped++;
        }
      }

      for (const observation of input.observations ?? []) {
        const plan = prepared.messageByFixtureKey.get(observation.messageKey);
        if (!plan) {
          throw new SeedGuardError(
            `La observación de ${observation.messageKey} no está completa`,
          );
        }
        if (await ensureObservation(tx, plan, observation)) {
          counts.observationsCreated++;
        } else {
          counts.observationsSkipped++;
        }
      }

      const reversals = await ensureReversions(tx, prepared);
      counts.reversalsCreated = reversals.created;
      counts.reversalsSkipped = reversals.skipped;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 60_000,
    },
  );

  const rebuild = await rebuildKnowledge({
    prisma,
    requesterId: input.requesterId,
  });
  const { personalRows, globalRows } = await summarizeProjection({
    prisma,
    prepared,
  });
  const summary = {
    personal: countStates(personalRows, 'USER'),
    global: countStates(globalRows, 'GLOBAL'),
  };
  assertProjectionSummary({ prepared, personalRows, globalRows, summary });
  return {
    evidence: counts,
    rebuild: { runId: rebuild.runId, items: rebuild.items },
    projection: summary,
  };
}
