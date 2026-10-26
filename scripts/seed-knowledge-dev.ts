import { createHash } from 'node:crypto';
import { createScriptPrismaClient, Prisma } from '../packages/database/dist';

const ADMIN_EMAIL = 'admin@gmail.com';
const MIGRATION = '20261101090009_ai_knowledge';
const SEED_VERSION = 'qa-ai4-knowledge-dev-v1';
// Fingerprint of the DEV Supabase project, never a database password or token.
const DEV_PROJECT_SHA256 =
  'ef83b1ec8ea0c5e8fb11856bf22575b6607e8b01aeb1afcea836fe9b7d7e5688';
const FIRST_SEEN_AT = new Date('2026-10-26T12:00:00.000Z');
const LAST_SEEN_AT = new Date('2026-10-26T12:05:00.000Z');

class SeedGuardError extends Error {}

function assertDevelopmentEnvironment(): void {
  if (process.env.NODE_ENV !== 'development') {
    throw new SeedGuardError('NODE_ENV debe ser development');
  }
  for (const key of [
    'INFISICAL_ENV',
    'INFISICAL_ENVIRONMENT',
    'RAILWAY_ENVIRONMENT',
    'RAILWAY_ENVIRONMENT_NAME',
    'APP_ENV',
    'ENVIRONMENT',
    'STAGE',
  ]) {
    const value = process.env[key]?.trim().toLowerCase();
    if (value && value !== 'dev' && value !== 'development') {
      throw new SeedGuardError(`${key} no indica DEV`);
    }
  }

  const databaseUrl = process.env.DATABASE_URL;
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!databaseUrl || !supabaseUrl) {
    throw new SeedGuardError('Faltan las URL de la base DEV');
  }
  let database: URL;
  let supabase: URL;
  try {
    database = new URL(databaseUrl);
    supabase = new URL(supabaseUrl);
  } catch {
    throw new SeedGuardError('Las URL de DEV no son válidas');
  }
  const projectRef = supabase.hostname.split('.')[0];
  const databaseRef = database.username.split('.').at(-1);
  const fingerprint = createHash('sha256').update(projectRef).digest('hex');
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    !database.hostname.endsWith('.pooler.supabase.com') ||
    supabase.protocol !== 'https:' ||
    !supabase.hostname.endsWith('.supabase.co') ||
    !databaseRef ||
    databaseRef !== projectRef ||
    fingerprint !== DEV_PROJECT_SHA256
  ) {
    throw new SeedGuardError('La conexión no coincide con Supabase DEV');
  }
}

function fixtureId(
  scope: string,
  type: string,
  key: string,
  userId: string | null,
) {
  const hex = createHash('sha256')
    .update(`${SEED_VERSION}|${scope}|${userId ?? ''}|${type}|${key}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

type SeedRow = Prisma.AiKnowledgeCreateManyInput & { id: string };

function fixtures(userId: string): SeedRow[] {
  const userLabel = {
    label: {
      relevance: true,
      semanticType: 'FIN_TRANSACTION',
      routes: ['FINANCE'],
      transaction: { kind: 'TRANSACTION', amount: 125.5, currency: 'DOP' },
    },
  };
  const globalTransaction = {
    label: {
      relevance: true,
      semanticType: 'FIN_TRANSACTION',
      routes: ['FINANCE'],
      transaction: { kind: 'TRANSACTION' },
    },
  };
  const globalAlert = {
    label: {
      relevance: true,
      semanticType: 'SECURITY_ALERT',
      routes: ['SECURITY'],
    },
  };
  const definitions = [
    {
      scope: 'USER',
      userId,
      knowledgeType: 'EMAIL_SENDER',
      knowledgeKey: 'qa-alerts@qa-ai4-payments.example',
      state: 'STABLE',
      payload: userLabel,
      messagesSeen: 2,
      humanVerifiedCount: 1,
    },
    {
      scope: 'USER',
      userId,
      knowledgeType: 'EMAIL_DOMAIN',
      knowledgeKey: 'qa-ai4-payments.example',
      state: 'STABLE',
      payload: userLabel,
      messagesSeen: 2,
      humanVerifiedCount: 1,
    },
    {
      scope: 'USER',
      userId,
      knowledgeType: 'EMAIL_TEMPLATE',
      knowledgeKey: 'qa-ai4-payments.example|consumo <monto>',
      state: 'OBSERVED',
      payload: userLabel,
      messagesSeen: 1,
      humanVerifiedCount: 0,
    },
    {
      scope: 'USER',
      userId,
      knowledgeType: 'EMAIL_TEMPLATE',
      knowledgeKey: 'qa-ai4-subscriptions.example|pago <monto>',
      state: 'OBSERVED',
      payload: userLabel,
      messagesSeen: 1,
      humanVerifiedCount: 0,
    },
    {
      scope: 'GLOBAL',
      userId: null,
      knowledgeType: 'EMAIL_DOMAIN',
      knowledgeKey: 'qa-ai4-payments.example',
      state: 'STABLE',
      payload: globalTransaction,
      messagesSeen: 3,
      humanVerifiedCount: 3,
    },
    {
      scope: 'GLOBAL',
      userId: null,
      knowledgeType: 'EMAIL_TEMPLATE',
      knowledgeKey: 'qa-ai4-payments.example|consumo <monto>',
      state: 'STABLE',
      payload: globalTransaction,
      messagesSeen: 3,
      humanVerifiedCount: 3,
    },
    {
      scope: 'GLOBAL',
      userId: null,
      knowledgeType: 'EMAIL_DOMAIN',
      knowledgeKey: 'qa-ai4-subscriptions.example',
      state: 'REVIEW_REQUIRED',
      payload: globalTransaction,
      messagesSeen: 1,
      humanVerifiedCount: 1,
    },
    {
      scope: 'GLOBAL',
      userId: null,
      knowledgeType: 'EMAIL_TEMPLATE',
      knowledgeKey: 'qa-ai4-subscriptions.example|pago <monto>',
      state: 'REVIEW_REQUIRED',
      payload: globalTransaction,
      messagesSeen: 1,
      humanVerifiedCount: 1,
    },
    {
      scope: 'GLOBAL',
      userId: null,
      knowledgeType: 'EMAIL_DOMAIN',
      knowledgeKey: 'qa-ai4-alerts.example',
      state: 'BLOCKED',
      payload: globalAlert,
      messagesSeen: 3,
      humanVerifiedCount: 3,
    },
    {
      scope: 'GLOBAL',
      userId: null,
      knowledgeType: 'EMAIL_TEMPLATE',
      knowledgeKey: 'qa-ai4-alerts.example|alerta de cuenta',
      state: 'BLOCKED',
      payload: globalAlert,
      messagesSeen: 3,
      humanVerifiedCount: 3,
    },
  ] as const;

  return definitions.map((row) => ({
    ...row,
    id: fixtureId(row.scope, row.knowledgeType, row.knowledgeKey, row.userId),
    distinctUsers:
      row.scope === 'GLOBAL' ? (row.state === 'REVIEW_REQUIRED' ? 1 : 3) : 0,
    rejectedMessages: row.state === 'BLOCKED' ? 1 : 0,
    promotedBy:
      row.scope === 'GLOBAL' && row.state === 'STABLE' ? 'AUTO' : null,
    projectorVersion: SEED_VERSION,
    policyVersion: SEED_VERSION,
    normalizerVersion: SEED_VERSION,
    sanitizerVersion: SEED_VERSION,
    firstSeenAt: FIRST_SEEN_AT,
    lastSeenAt: LAST_SEEN_AT,
  }));
}

async function main(): Promise<void> {
  assertDevelopmentEnvironment();
  const dryRun = process.argv.includes('--dry-run');
  const prisma = createScriptPrismaClient();
  try {
    const counts = await prisma.$transaction(
      async (tx) => {
        const migration = await tx.$queryRaw<
          Array<{ finished_at: Date | null; rolled_back_at: Date | null }>
        >`SELECT finished_at, rolled_back_at FROM "_prisma_migrations" WHERE migration_name = ${MIGRATION} ORDER BY started_at DESC LIMIT 1`;
        if (!migration[0]?.finished_at || migration[0].rolled_back_at) {
          throw new SeedGuardError(
            'La migración de Knowledge no está aplicada en DEV',
          );
        }
        const user = await tx.user.findUnique({
          where: { email: ADMIN_EMAIL },
          select: { id: true },
        });
        if (!user) {
          throw new SeedGuardError('No existe el usuario QA admin en DEV');
        }
        const role = await tx.userRole.findUnique({
          where: { userId: user.id },
          select: { role: true },
        });
        if (role?.role !== 'ADMIN') {
          throw new SeedGuardError('El usuario QA no tiene rol ADMIN');
        }
        const rows = fixtures(user.id);
        if (!dryRun) {
          const existing = await tx.aiKnowledge.findMany({
            where: { id: { in: rows.map((row) => row.id) } },
            select: {
              id: true,
              scope: true,
              userId: true,
              knowledgeType: true,
              knowledgeKey: true,
            },
          });
          for (const found of existing) {
            const planned = rows.find((row) => row.id === found.id);
            if (
              !planned ||
              planned.scope !== found.scope ||
              planned.userId !== found.userId ||
              planned.knowledgeType !== found.knowledgeType ||
              planned.knowledgeKey !== found.knowledgeKey
            ) {
              throw new SeedGuardError('Colisión con una fila ajena al seed');
            }
          }
          await tx.aiKnowledge.createMany({ data: rows, skipDuplicates: true });
          for (const row of rows) {
            await tx.aiKnowledge.update({
              where: { id: row.id },
              data: {
                state: row.state,
                payload: row.payload,
                messagesSeen: row.messagesSeen,
                rejectedMessages: row.rejectedMessages,
                distinctUsers: row.distinctUsers,
                humanVerifiedCount: row.humanVerifiedCount,
                promotedBy: row.promotedBy,
                projectorVersion: row.projectorVersion,
                policyVersion: row.policyVersion,
                normalizerVersion: row.normalizerVersion,
                sanitizerVersion: row.sanitizerVersion,
                firstSeenAt: row.firstSeenAt,
                lastSeenAt: row.lastSeenAt,
              },
            });
          }
        }
        const actual = dryRun
          ? rows.map(({ scope, state }) => ({ scope, state }))
          : await tx.aiKnowledge.findMany({
              where: { id: { in: rows.map((row) => row.id) } },
              select: { scope: true, state: true },
            });
        if (actual.length !== rows.length) {
          throw new SeedGuardError('El conteo de filas del seed no coincide');
        }
        return actual.reduce<Record<string, number>>((summary, row) => {
          const key = `${row.scope}/${row.state}`;
          summary[key] = (summary[key] ?? 0) + 1;
          return summary;
        }, {});
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 30_000,
      },
    );
    console.log(
      JSON.stringify({ mode: dryRun ? 'DRY_RUN' : 'APPLIED', counts }),
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  if (error instanceof SeedGuardError) {
    console.error(`Seed abortado: ${error.message}`);
  } else {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : 'UNKNOWN';
    console.error(`Seed abortado por error de base (${code})`);
  }
  process.exitCode = 1;
});
