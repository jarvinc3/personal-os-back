import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createScriptPrismaClient, Prisma } from '../packages/database/dist';
import {
  SeedGuardError,
  assertDevelopmentEnvironment,
} from './lib/dev-seed-guard';
import { seedUuid } from './lib/seed-fixtures';

const QA_EMAIL = 'qa-user@personal-os.dev';
const QA_FULL_NAME = 'QA User';
const MIGRATION = '20261101090009_ai_knowledge';
const SEED_VERSION = 'qa-user-dev-v1';
const DEFAULT_PASSWORD_FILE = 'C:/dev/personal/personal-os/qa-user-dev.txt';
const PASSWORD_BYTES = 24;
const FIRST_SEEN_AT = new Date('2026-10-26T12:00:00.000Z');
const LAST_SEEN_AT = new Date('2026-10-26T12:05:00.000Z');
const DRY_RUN_FLAG = '--dry-run';

type SeedRow = Prisma.AiKnowledgeCreateManyInput & { id: string };

type KnowledgeFixture = {
  knowledgeType: Prisma.AiKnowledgeCreateManyInput['knowledgeType'];
  knowledgeKey: string;
  state: Prisma.AiKnowledgeCreateManyInput['state'];
  payload: Prisma.InputJsonValue;
  messagesSeen: number;
  rejectedMessages: number;
  humanVerifiedCount: number;
};

const KNOWLEDGE_FIXTURES: readonly KnowledgeFixture[] = [
  {
    knowledgeType: 'EMAIL_SENDER',
    knowledgeKey: 'qa-user-alerts@qa-personal-os.example',
    state: 'STABLE',
    payload: {
      label: {
        relevance: true,
        semanticType: 'SECURITY_ALERT',
        routes: ['SECURITY'],
      },
    },
    messagesSeen: 4,
    rejectedMessages: 0,
    humanVerifiedCount: 2,
  },
  {
    knowledgeType: 'EMAIL_TEMPLATE',
    knowledgeKey: 'qa-personal-os.example|pago de servicio <monto>',
    state: 'STABLE',
    payload: {
      label: {
        relevance: true,
        semanticType: 'FIN_TRANSACTION',
        routes: ['FINANCE'],
        transaction: {
          kind: 'TRANSACTION',
          amount: 42.5,
          currency: 'DOP',
        },
      },
    },
    messagesSeen: 3,
    rejectedMessages: 0,
    humanVerifiedCount: 1,
  },
  {
    knowledgeType: 'EMAIL_SENDER',
    knowledgeKey: 'qa-user-promos@qa-personal-os.example',
    state: 'REVIEW_REQUIRED',
    payload: {
      label: {
        relevance: true,
        semanticType: 'MARKETING',
        routes: [],
      },
    },
    messagesSeen: 2,
    rejectedMessages: 0,
    humanVerifiedCount: 0,
  },
  {
    knowledgeType: 'EMAIL_TEMPLATE',
    knowledgeKey:
      'qa-user-statements@qa-personal-os.example|estado de cuenta <mes>',
    state: 'REVIEW_REQUIRED',
    payload: {
      label: {
        relevance: true,
        semanticType: 'FIN_STATEMENT_NOTICE',
        routes: ['FINANCE'],
      },
    },
    messagesSeen: 1,
    rejectedMessages: 0,
    humanVerifiedCount: 0,
  },
  {
    knowledgeType: 'EMAIL_DOMAIN',
    knowledgeKey: 'qa-blocked.example',
    state: 'BLOCKED',
    payload: {
      label: {
        relevance: false,
        semanticType: 'SOCIAL',
        routes: [],
      },
    },
    messagesSeen: 3,
    rejectedMessages: 1,
    humanVerifiedCount: 0,
  },
  {
    knowledgeType: 'EMAIL_TEMPLATE',
    knowledgeKey: 'qa-blocked.example|alerta de cuenta <monto>',
    state: 'BLOCKED',
    payload: {
      label: {
        relevance: true,
        semanticType: 'SECURITY_ALERT',
        routes: ['SECURITY'],
      },
    },
    messagesSeen: 2,
    rejectedMessages: 2,
    humanVerifiedCount: 0,
  },
];

type KnowledgeSyncResult = {
  created: number;
  updated: number;
  counts: Record<string, number>;
};

type EnsureQaAuthUserInput = {
  client: SupabaseClient;
  existingUserId: string | null;
  password: string;
};

type ExistingKnowledgeRow = {
  id: string;
  scope: string;
  userId: string | null;
  knowledgeType: string;
  knowledgeKey: string;
};

function buildFixtures(userId: string): SeedRow[] {
  return KNOWLEDGE_FIXTURES.map((fixture) => ({
    ...fixture,
    id: seedUuid({
      seedVersion: SEED_VERSION,
      scope: 'USER',
      type: fixture.knowledgeType,
      key: fixture.knowledgeKey,
      userId,
    }),
    scope: 'USER',
    userId,
    distinctUsers: 0,
    promotedBy: null,
    projectorVersion: SEED_VERSION,
    policyVersion: SEED_VERSION,
    normalizerVersion: SEED_VERSION,
    sanitizerVersion: SEED_VERSION,
    firstSeenAt: FIRST_SEEN_AT,
    lastSeenAt: LAST_SEEN_AT,
  }));
}

function plannedKnowledgeCounts(): Record<string, number> {
  return KNOWLEDGE_FIXTURES.reduce<Record<string, number>>(
    (summary, fixture) => {
      const key = `USER/${fixture.state}`;
      summary[key] = (summary[key] ?? 0) + 1;
      return summary;
    },
    {},
  );
}

function requireServiceRoleKey(): string {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) {
    throw new SeedGuardError('Falta SUPABASE_SERVICE_ROLE_KEY de DEV');
  }
  return serviceRoleKey;
}

function resolvePasswordFile(): string {
  const configuredPath = process.env.QA_PASSWORD_FILE?.trim();
  const passwordFile = resolve(configuredPath || DEFAULT_PASSWORD_FILE);
  const repositoryRoot = resolve(__dirname, '..');
  const relativePath = relative(repositoryRoot, passwordFile);
  const insideRepository =
    relativePath === '' ||
    (!isAbsolute(relativePath) &&
      relativePath !== '..' &&
      !relativePath.startsWith(`..${sep}`));
  if (insideRepository) {
    throw new SeedGuardError(
      'El archivo de contraseña debe quedar fuera del repositorio',
    );
  }
  return passwordFile;
}

async function assertKnowledgeMigration(
  prismaClient: Prisma.TransactionClient,
): Promise<void> {
  const migration = await prismaClient.$queryRaw<
    Array<{ finished_at: Date | null; rolled_back_at: Date | null }>
  >`SELECT finished_at, rolled_back_at FROM "_prisma_migrations" WHERE migration_name = ${MIGRATION} ORDER BY started_at DESC LIMIT 1`;
  if (!migration[0]?.finished_at || migration[0].rolled_back_at) {
    throw new SeedGuardError(
      'La migración de Knowledge no está aplicada en DEV',
    );
  }
}

async function assertNoForeignKnowledgeCollisions({
  rows,
  existingRows,
  prismaClient,
  userId,
}: {
  rows: readonly SeedRow[];
  existingRows: readonly ExistingKnowledgeRow[];
  prismaClient: Prisma.TransactionClient;
  userId: string;
}): Promise<void> {
  for (const found of existingRows) {
    const planned = rows.find((row) => row.id === found.id);
    if (
      !planned ||
      planned.scope !== found.scope ||
      planned.userId !== found.userId ||
      planned.knowledgeType !== found.knowledgeType ||
      planned.knowledgeKey !== found.knowledgeKey
    ) {
      throw new SeedGuardError('Colisión con una fila ajena al seed de QA');
    }
  }

  const conflictingKeys = await prismaClient.aiKnowledge.findMany({
    where: {
      scope: 'USER',
      userId,
      id: { notIn: rows.map((row) => row.id) },
      OR: rows.map((row) => ({
        knowledgeType: row.knowledgeType,
        knowledgeKey: row.knowledgeKey,
      })),
    },
    select: { id: true },
  });
  if (conflictingKeys.length > 0) {
    throw new SeedGuardError(
      'Otra fila del usuario QA ocupa una clave del seed',
    );
  }
}

async function ensureQaNonAdminRole({
  prismaClient,
  userId,
}: {
  prismaClient: Prisma.TransactionClient;
  userId: string;
}): Promise<void> {
  const assignment = await prismaClient.userRole.findUnique({
    where: { userId },
    select: { role: true },
  });
  if (!assignment) {
    return;
  }
  if (assignment.role === 'ADMIN') {
    const adminCount = await prismaClient.userRole.count({
      where: { role: 'ADMIN' },
    });
    if (adminCount <= 1) {
      throw new SeedGuardError(
        'La cuenta QA es el único ADMIN y no se puede degradar',
      );
    }
  }
  await prismaClient.userRole.delete({ where: { userId } });
}

async function syncKnowledgeRows({
  prismaClient,
  userId,
  rows,
}: {
  prismaClient: Prisma.TransactionClient;
  userId: string;
  rows: readonly SeedRow[];
}): Promise<KnowledgeSyncResult> {
  const existingRows = await prismaClient.aiKnowledge.findMany({
    where: { id: { in: rows.map((row) => row.id) } },
    select: {
      id: true,
      scope: true,
      userId: true,
      knowledgeType: true,
      knowledgeKey: true,
    },
  });
  await assertNoForeignKnowledgeCollisions({
    rows,
    existingRows,
    prismaClient,
    userId,
  });

  await prismaClient.aiKnowledge.createMany({
    data: [...rows],
    skipDuplicates: true,
  });
  for (const row of rows) {
    await prismaClient.aiKnowledge.update({
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

  const actual = await prismaClient.aiKnowledge.findMany({
    where: { id: { in: rows.map((row) => row.id) } },
    select: { scope: true, state: true },
  });
  if (actual.length !== rows.length) {
    throw new SeedGuardError('El conteo de filas del seed de QA no coincide');
  }

  return {
    created: rows.length - existingRows.length,
    updated: existingRows.length,
    counts: actual.reduce<Record<string, number>>((summary, row) => {
      const key = `${row.scope}/${row.state}`;
      summary[key] = (summary[key] ?? 0) + 1;
      return summary;
    }, {}),
  };
}

async function readVerifiedAuthUser({
  client,
  userId,
}: {
  client: SupabaseClient;
  userId: string;
}): Promise<{ id: string }> {
  const { data, error } = await client.auth.admin.getUserById(userId);
  if (error || !data.user) {
    throw new SeedGuardError('No se pudo leer la cuenta QA en Supabase Auth');
  }
  if (data.user.email !== QA_EMAIL) {
    throw new SeedGuardError('La cuenta QA de Auth tiene otro correo');
  }
  if (!data.user.email_confirmed_at) {
    throw new SeedGuardError('La cuenta QA no tiene el correo verificado');
  }
  return { id: data.user.id };
}

async function ensureVerifiedQaAuthUser({
  client,
  existingUserId,
  password,
}: EnsureQaAuthUserInput): Promise<{ id: string; created: boolean }> {
  if (existingUserId) {
    const { error } = await client.auth.admin.updateUserById(existingUserId, {
      password,
      email_confirm: true,
      user_metadata: { full_name: QA_FULL_NAME },
    });
    if (error) {
      throw new SeedGuardError(
        `Supabase Auth no actualizó la cuenta QA (${error.code ?? 'UNKNOWN'})`,
      );
    }
    const authUser = await readVerifiedAuthUser({
      client,
      userId: existingUserId,
    });
    return { id: authUser.id, created: false };
  }

  const { data, error } = await client.auth.admin.createUser({
    email: QA_EMAIL,
    password,
    email_confirm: true,
    user_metadata: { full_name: QA_FULL_NAME },
  });
  if (error || !data.user) {
    throw new SeedGuardError(
      `Supabase Auth no creó la cuenta QA (${error?.code ?? 'UNKNOWN'})`,
    );
  }
  const authUser = await readVerifiedAuthUser({
    client,
    userId: data.user.id,
  });
  return { id: authUser.id, created: true };
}

async function writePasswordFile({
  filePath,
  password,
}: {
  filePath: string;
  password: string;
}): Promise<void> {
  await writeFile(filePath, `${password}\n`, { encoding: 'utf8', mode: 0o600 });
}

async function previewDryRun(
  prisma: ReturnType<typeof createScriptPrismaClient>,
) {
  return prisma.$transaction(async (tx) => {
    await assertKnowledgeMigration(tx);
    const user = await tx.user.findUnique({
      where: { email: QA_EMAIL },
      select: { id: true },
    });
    if (!user) {
      return {
        accountExists: false,
        created: KNOWLEDGE_FIXTURES.length,
        updated: 0,
        counts: plannedKnowledgeCounts(),
      };
    }
    const rows = buildFixtures(user.id);
    const existingCount = await tx.aiKnowledge.count({
      where: { id: { in: rows.map((row) => row.id) } },
    });
    return {
      accountExists: true,
      created: rows.length - existingCount,
      updated: existingCount,
      counts: plannedKnowledgeCounts(),
    };
  });
}

async function main(): Promise<void> {
  const { supabaseUrl } = assertDevelopmentEnvironment();
  const serviceRoleKey = requireServiceRoleKey();
  const passwordFile = resolvePasswordFile();
  const dryRun = process.argv.includes(DRY_RUN_FLAG);
  const password = randomBytes(PASSWORD_BYTES).toString('base64url');
  const prisma = createScriptPrismaClient();
  try {
    if (dryRun) {
      const preview = await previewDryRun(prisma);
      console.log(
        JSON.stringify({
          mode: 'DRY_RUN',
          accountEmail: QA_EMAIL,
          plannedRole: 'USER',
          ...preview,
          passwordFile,
        }),
      );
      return;
    }

    await prisma.$transaction(async (tx) => {
      await assertKnowledgeMigration(tx);
    });

    const existingUser = await prisma.user.findUnique({
      where: { email: QA_EMAIL },
      select: { id: true },
    });
    const authClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const authUser = await ensureVerifiedQaAuthUser({
      client: authClient,
      existingUserId: existingUser?.id ?? null,
      password,
    });
    const appUser = await prisma.user.findUnique({
      where: { email: QA_EMAIL },
      select: { id: true },
    });
    if (!appUser || appUser.id !== authUser.id) {
      throw new SeedGuardError(
        'El perfil de la cuenta QA no coincide con Supabase Auth',
      );
    }

    const knowledgeSummary = await prisma.$transaction(
      async (tx) => {
        await assertKnowledgeMigration(tx);
        await ensureQaNonAdminRole({ prismaClient: tx, userId: appUser.id });
        return syncKnowledgeRows({
          prismaClient: tx,
          userId: appUser.id,
          rows: buildFixtures(appUser.id),
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 30_000,
      },
    );

    await writePasswordFile({ filePath: passwordFile, password });
    console.log(
      JSON.stringify({
        mode: 'APPLIED',
        account: {
          email: QA_EMAIL,
          role: 'USER',
          emailVerified: true,
          created: authUser.created,
        },
        knowledge: knowledgeSummary,
        passwordFile,
      }),
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
