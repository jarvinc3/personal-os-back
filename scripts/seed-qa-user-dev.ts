import { writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createScriptPrismaClient } from '../packages/database/dist';
import type { EmailLabel } from '../packages/ai-agent/dist/intelligence/knowledge/knowledge-payload';
import {
  SeedGuardError,
  assertDevelopmentEnvironment,
} from './lib/dev-seed-guard';
import {
  assertKnowledgeMigration,
  describeKnowledgeEvidence,
  ensureAdminRole,
  seedKnowledgeEvidence,
  type EvidenceMessage,
  type EvidenceObservation,
  type EvidenceVerification,
  type KnowledgeEvidenceInput,
} from './lib/knowledge-evidence';
import { generateQaPassword } from './lib/qa-password';

const QA_EMAIL = 'qa-user@personal-os.dev';
const QA_FULL_NAME = 'QA User';
const ADMIN_EMAIL = 'admin@gmail.com';
const SEED_VERSION = 'qa-user-dev-v2';
const DEFAULT_PASSWORD_FILE = 'C:/dev/personal/personal-os/qa-user-dev.txt';
const DRY_RUN_FLAG = '--dry-run';
const BASE_TIME = new Date('2026-10-26T12:00:00.000Z');

type SeedPrisma = ReturnType<typeof createScriptPrismaClient>;

const minutesAfter = (minutes: number) =>
  new Date(BASE_TIME.getTime() + minutes * 60_000);

const STABLE_LABEL: EmailLabel = {
  relevance: true,
  semanticType: 'FIN_TRANSACTION',
  routes: ['FINANCE'],
  transaction: { kind: 'TRANSACTION', amount: 42.5, currency: 'DOP' },
};

const PENDING_LABEL_A: EmailLabel = {
  relevance: true,
  semanticType: 'FIN_TRANSACTION',
  routes: ['FINANCE'],
  transaction: { kind: 'TRANSACTION' },
};

const PENDING_LABEL_B: EmailLabel = {
  relevance: true,
  semanticType: 'SECURITY_ALERT',
  routes: ['SECURITY'],
};

const OBSERVED_LABEL: EmailLabel = {
  relevance: true,
  semanticType: 'SECURITY_ALERT',
  routes: ['SECURITY'],
};

const BLOCKED_LABEL: EmailLabel = {
  relevance: true,
  semanticType: 'SECURITY_ALERT',
  routes: ['SECURITY'],
};

type EnsureQaAuthUserInput = {
  client: SupabaseClient;
  existingUserId: string | null;
  password: string;
};

function evidenceFixtures(
  qaUserId: string,
  adminUserId: string,
): {
  messages: EvidenceMessage[];
  verifications: EvidenceVerification[];
  observations: EvidenceObservation[];
} {
  return {
    messages: [
      {
        key: 'qa-payments-stable',
        userId: qaUserId,
        fromAddress: 'qa-user-payments@qa-user-payments.example',
        subject: 'Pago de factura RD$1,250',
        receivedAt: minutesAfter(0),
        globalState: 'STABLE',
      },
      {
        key: 'admin-payments-stable',
        userId: adminUserId,
        fromAddress: 'billing@qa-user-payments.example',
        subject: 'Pago de factura RD$2,500',
        receivedAt: minutesAfter(2),
        globalState: 'STABLE',
      },
      {
        key: 'qa-observed',
        userId: qaUserId,
        fromAddress: 'qa-user-notices@qa-user-observed.example',
        subject: 'Alerta de cuenta',
        receivedAt: minutesAfter(5),
      },
      {
        key: 'qa-pending',
        userId: qaUserId,
        fromAddress: 'qa-user-billing@qa-user-pending.example',
        subject: 'Pago RD$3,000',
        receivedAt: minutesAfter(10),
        globalState: 'REVIEW_REQUIRED',
      },
      {
        key: 'admin-pending',
        userId: adminUserId,
        fromAddress: 'billing@qa-user-pending.example',
        subject: 'Pago RD$4,000',
        receivedAt: minutesAfter(12),
        globalState: 'REVIEW_REQUIRED',
      },
      {
        key: 'qa-blocked',
        userId: qaUserId,
        fromAddress: 'qa-user-security@qa-user-security.example',
        subject: 'Alerta de cuenta',
        receivedAt: minutesAfter(20),
        globalState: 'BLOCKED',
      },
    ],
    verifications: [
      {
        messageKey: 'qa-payments-stable',
        userId: qaUserId,
        verdict: 'CORRECTED',
        label: STABLE_LABEL,
        createdAt: minutesAfter(1),
      },
      {
        messageKey: 'admin-payments-stable',
        userId: adminUserId,
        verdict: 'CORRECTED',
        label: STABLE_LABEL,
        createdAt: minutesAfter(3),
      },
      {
        messageKey: 'qa-pending',
        userId: qaUserId,
        verdict: 'CORRECTED',
        label: PENDING_LABEL_A,
        createdAt: minutesAfter(11),
      },
      {
        messageKey: 'admin-pending',
        userId: adminUserId,
        verdict: 'CORRECTED',
        label: PENDING_LABEL_B,
        createdAt: minutesAfter(13),
      },
      {
        messageKey: 'qa-blocked',
        userId: qaUserId,
        verdict: 'CORRECTED',
        label: BLOCKED_LABEL,
        createdAt: minutesAfter(21),
      },
    ],
    observations: [
      {
        messageKey: 'qa-observed',
        userId: qaUserId,
        knowledgeType: 'EMAIL_SENDER',
        label: OBSERVED_LABEL,
        createdAt: minutesAfter(6),
      },
      {
        messageKey: 'qa-observed',
        userId: qaUserId,
        knowledgeType: 'EMAIL_TEMPLATE',
        label: OBSERVED_LABEL,
        createdAt: minutesAfter(6),
      },
    ],
  };
}

function evidenceInput(
  qaUserId: string,
  adminUserId: string,
): KnowledgeEvidenceInput {
  return {
    seedVersion: SEED_VERSION,
    users: [
      { id: qaUserId, email: QA_EMAIL, role: 'USER' },
      { id: adminUserId, email: ADMIN_EMAIL, role: 'ADMIN' },
    ],
    ...evidenceFixtures(qaUserId, adminUserId),
    summaryUserId: qaUserId,
    requesterId: adminUserId,
  };
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

async function ensureQaNonAdminRole({
  prisma,
  userId,
}: {
  prisma: SeedPrisma;
  userId: string;
}): Promise<void> {
  const assignment = await prisma.userRole.findUnique({
    where: { userId },
    select: { role: true },
  });
  if (!assignment) {
    return;
  }
  if (assignment.role === 'ADMIN') {
    const adminCount = await prisma.userRole.count({
      where: { role: 'ADMIN' },
    });
    if (adminCount <= 1) {
      throw new SeedGuardError(
        'La cuenta QA es el único ADMIN y no se puede degradar',
      );
    }
  }
  await prisma.userRole.delete({ where: { userId } });
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

async function main(): Promise<void> {
  const { supabaseUrl } = assertDevelopmentEnvironment();
  const serviceRoleKey = requireServiceRoleKey();
  const passwordFile = resolvePasswordFile();
  const dryRun = process.argv.includes(DRY_RUN_FLAG);
  const prisma = createScriptPrismaClient();
  try {
    await assertKnowledgeMigration(prisma);
    const existingUser = await prisma.user.findUnique({
      where: { email: QA_EMAIL },
      select: { id: true },
    });
    const admin = await ensureAdminRole({ prisma, email: ADMIN_EMAIL });
    if (dryRun) {
      const plannedInput = evidenceInput(
        existingUser?.id ?? 'dry-run-qa-user',
        admin.id,
      );
      console.log(
        JSON.stringify({
          mode: 'DRY_RUN',
          accountEmail: QA_EMAIL,
          accountExists: Boolean(existingUser),
          plannedRole: 'USER',
          planned: describeKnowledgeEvidence(plannedInput),
          passwordFile,
        }),
      );
      return;
    }

    const password = generateQaPassword();
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
    await ensureQaNonAdminRole({ prisma, userId: appUser.id });

    const seedResult = await seedKnowledgeEvidence({
      prisma,
      input: evidenceInput(appUser.id, admin.id),
    });
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
        ...seedResult,
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
    const message =
      error instanceof Error ? error.message : 'Error desconocido';
    console.error(`Seed abortado por error de base (${code}): ${message}`);
  }
  process.exitCode = 1;
});
