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
  const counts: MigrationCounts = { encrypted: 0, completed: 0, unchanged: 0 };
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
        await migrateAccount(prisma, account, secret, counts);
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

async function migrateAccount(
  prisma: ReturnType<typeof createScriptPrismaClient>,
  account: AccountNumberRow,
  secret: string,
  counts: MigrationCounts,
): Promise<void> {
  const stored = account.accountNumber;
  if (stored === null) {
    return;
  }
  if (DIGITS_ONLY.test(stored)) {
    await prisma.finAccount.update({
      where: { id: account.id },
      data: {
        accountNumber: encryptAccountNumber(stored, secret),
        accountNumberLast4: accountNumberLast4(stored),
        accountNumberHash: fingerprintAccountNumber(stored, secret),
      },
    });
    counts.encrypted += 1;
    return;
  }

  const plaintext = decryptAccountNumber(stored, secret);
  if (
    account.accountNumberLast4 !== null &&
    account.accountNumberHash !== null
  ) {
    counts.unchanged += 1;
    return;
  }
  await prisma.finAccount.update({
    where: { id: account.id },
    data: {
      accountNumberLast4: accountNumberLast4(plaintext),
      accountNumberHash: fingerprintAccountNumber(plaintext, secret),
    },
  });
  counts.completed += 1;
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
