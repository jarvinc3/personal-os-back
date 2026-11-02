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

const ADMIN_EMAIL = 'admin@gmail.com';
const SEED_VERSION = 'qa-ai4-knowledge-dev-v2';
const DRY_RUN_FLAG = '--dry-run';
const BASE_TIME = new Date('2026-10-26T12:00:00.000Z');

const minutesAfter = (minutes: number) =>
  new Date(BASE_TIME.getTime() + minutes * 60_000);

const STABLE_LABEL: EmailLabel = {
  relevance: true,
  semanticType: 'FIN_TRANSACTION',
  routes: ['FINANCE'],
  transaction: { kind: 'TRANSACTION', amount: 1_250, currency: 'DOP' },
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

function evidenceFixtures(adminUserId: string): {
  messages: EvidenceMessage[];
  verifications: EvidenceVerification[];
  observations: EvidenceObservation[];
} {
  return {
    messages: [
      {
        key: 'payments-stable',
        userId: adminUserId,
        fromAddress: 'qa-alerts@qa-ai4-payments.example',
        subject: 'Consumo RD$1,250',
        receivedAt: minutesAfter(0),
        globalState: 'STABLE',
      },
      {
        key: 'subscriptions-observed',
        userId: adminUserId,
        fromAddress: 'qa-alerts@qa-ai4-observed.example',
        subject: 'Alerta de cuenta',
        receivedAt: minutesAfter(5),
      },
      {
        key: 'subscriptions-pending-a',
        userId: adminUserId,
        fromAddress: 'qa-alerts@qa-ai4-subscriptions.example',
        subject: 'Pago RD$2,500',
        receivedAt: minutesAfter(10),
        globalState: 'REVIEW_REQUIRED',
      },
      {
        key: 'subscriptions-pending-b',
        userId: adminUserId,
        fromAddress: 'qa-alerts@qa-ai4-subscriptions.example',
        subject: 'Pago RD$3,000',
        receivedAt: minutesAfter(15),
        globalState: 'REVIEW_REQUIRED',
      },
      {
        key: 'alerts-blocked',
        userId: adminUserId,
        fromAddress: 'qa-alerts@qa-ai4-alerts.example',
        subject: 'Alerta de cuenta',
        receivedAt: minutesAfter(20),
        globalState: 'BLOCKED',
      },
    ],
    verifications: [
      {
        messageKey: 'payments-stable',
        userId: adminUserId,
        verdict: 'CORRECTED',
        label: STABLE_LABEL,
        createdAt: minutesAfter(1),
      },
      {
        messageKey: 'subscriptions-pending-a',
        userId: adminUserId,
        verdict: 'CORRECTED',
        label: PENDING_LABEL_A,
        createdAt: minutesAfter(11),
      },
      {
        messageKey: 'subscriptions-pending-b',
        userId: adminUserId,
        verdict: 'CORRECTED',
        label: PENDING_LABEL_B,
        createdAt: minutesAfter(16),
      },
      {
        messageKey: 'alerts-blocked',
        userId: adminUserId,
        verdict: 'CORRECTED',
        label: BLOCKED_LABEL,
        createdAt: minutesAfter(21),
      },
    ],
    observations: [
      {
        messageKey: 'subscriptions-observed',
        userId: adminUserId,
        knowledgeType: 'EMAIL_TEMPLATE',
        label: OBSERVED_LABEL,
        createdAt: minutesAfter(6),
      },
    ],
  };
}

function evidenceInput(adminUserId: string): KnowledgeEvidenceInput {
  return {
    seedVersion: SEED_VERSION,
    users: [{ id: adminUserId, email: ADMIN_EMAIL, role: 'ADMIN' }],
    ...evidenceFixtures(adminUserId),
    summaryUserId: adminUserId,
    requesterId: adminUserId,
  };
}

async function main(): Promise<void> {
  assertDevelopmentEnvironment();
  const dryRun = process.argv.includes(DRY_RUN_FLAG);
  const prisma = createScriptPrismaClient();
  try {
    await assertKnowledgeMigration(prisma);
    const admin = await ensureAdminRole({ prisma, email: ADMIN_EMAIL });
    const input = evidenceInput(admin.id);
    if (dryRun) {
      console.log(
        JSON.stringify({
          mode: 'DRY_RUN',
          accountEmail: ADMIN_EMAIL,
          planned: describeKnowledgeEvidence(input),
        }),
      );
      return;
    }
    const seedResult = await seedKnowledgeEvidence({ prisma, input });
    console.log(
      JSON.stringify({
        mode: 'APPLIED',
        accountEmail: ADMIN_EMAIL,
        ...seedResult,
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
