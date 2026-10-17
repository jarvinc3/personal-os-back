import {
  accountNumberLast4,
  decryptAccountNumber,
  encryptAccountNumber,
  fingerprintAccountNumber,
} from '@personal-os/finance';
import { createScriptPrismaClient } from '@personal-os/database';

const BATCH_SIZE = 200;
const MIN_SECRET_LENGTH = 32;
const DIGITS_ONLY = /^\d+$/;

type AccountNumberRow = {
  id: string;
  accountNumber: string | null;
  accountNumberLast4: string | null;
  accountNumberHash: string | null;
};

type MigrationCounts = {
  encrypted: number;
  completed: number;
  unchanged: number;
};

type MigrationOutcome = keyof MigrationCounts;

function countOutcome(
  counts: MigrationCounts,
  outcome: MigrationOutcome,
): MigrationCounts {
  return { ...counts, [outcome]: counts[outcome] + 1 };
}

/**
 * Encrypts every plaintext `fin_accounts.account_number` with
 * DATA_ENCRYPTION_KEY and fills `account_number_last4` / `account_number_hash`.
 * Idempotent: rows that are already ciphertext are only completed when a
 * derived column is missing, never re-encrypted. Run once per environment
 * after `pnpm db:migrate:deploy`.
 */
async function main(): Promise<void> {
  const secret = process.env.DATA_ENCRYPTION_KEY;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `DATA_ENCRYPTION_KEY is required (min ${MIN_SECRET_LENGTH} chars)`,
    );
  }
  const prisma = createScriptPrismaClient();
  let counts: MigrationCounts = { encrypted: 0, completed: 0, unchanged: 0 };
  let cursor: string | undefined;
  let processed = 0;
  try {
    for (;;) {
      const batch = await prisma.finAccount.findMany({
        where: {
          accountNumber: { not: null },
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        select: {
          id: true,
          accountNumber: true,
          accountNumberLast4: true,
          accountNumberHash: true,
        },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
      });
      if (batch.length === 0) {
        break;
      }
      for (const account of batch) {
        const migration = planAccountMigration(account, secret);
        await persistAccountMigration({
          prisma,
          accountId: account.id,
          secret,
          migration,
        });
        counts = countOutcome(counts, migration.outcome);
      }
      cursor = batch[batch.length - 1].id;
      processed += batch.length;
    }
    process.stdout.write(
      `Processed ${processed} accounts: ${counts.encrypted} encrypted, ` +
        `${counts.completed} completed (already encrypted), ` +
        `${counts.unchanged} unchanged.\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

type AccountMigration = {
  outcome: MigrationOutcome;
  plaintext: string | null;
};

/** Pure decision for one row: what it needs and the plaintext involved. */
function planAccountMigration(
  account: AccountNumberRow,
  secret: string,
): AccountMigration {
  const stored = account.accountNumber;
  if (stored === null) {
    return { outcome: 'unchanged', plaintext: null };
  }
  if (DIGITS_ONLY.test(stored)) {
    return { outcome: 'encrypted', plaintext: stored };
  }
  const plaintext = decryptAccountNumber(stored, secret);
  if (
    account.accountNumberLast4 !== null &&
    account.accountNumberHash !== null
  ) {
    return { outcome: 'unchanged', plaintext };
  }
  return { outcome: 'completed', plaintext };
}

async function persistAccountMigration(params: {
  prisma: ReturnType<typeof createScriptPrismaClient>;
  accountId: string;
  secret: string;
  migration: AccountMigration;
}): Promise<void> {
  const { prisma, accountId, secret, migration } = params;
  if (migration.outcome === 'unchanged' || migration.plaintext === null) {
    return;
  }
  const derived = {
    accountNumberLast4: accountNumberLast4(migration.plaintext),
    accountNumberHash: fingerprintAccountNumber(migration.plaintext, secret),
  };
  if (migration.outcome === 'encrypted') {
    await prisma.finAccount.update({
      where: { id: accountId },
      data: {
        accountNumber: encryptAccountNumber(migration.plaintext, secret),
        ...derived,
      },
    });
    return;
  }
  await prisma.finAccount.update({
    where: { id: accountId },
    data: derived,
  });
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
