import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import type { DomainEventPublisher } from '@personal-os/contracts';
import { getPrismaClientClass } from '@personal-os/database';
// eslint-disable-next-line no-restricted-imports -- El test ejercita el repositorio real contra la base.
import { PrismaLedgerRepository } from '../../packages/finance/src/ledger/infrastructure/prisma-ledger.repository';
// eslint-disable-next-line no-restricted-imports -- El test arma el repositorio con sus colaboradores reales.
import { PrismaLedgerReadRepository } from '../../packages/finance/src/ledger/infrastructure/prisma-ledger-read.repository';
// eslint-disable-next-line no-restricted-imports -- El test arma el repositorio con sus colaboradores reales.
import { PrismaLedgerDeletionRepository } from '../../packages/finance/src/ledger/infrastructure/prisma-ledger-deletion.repository';
// eslint-disable-next-line no-restricted-imports -- El test arma el repositorio con sus colaboradores reales.
import { PrismaLedgerImportRepository } from '../../packages/finance/src/ledger/infrastructure/prisma-ledger-import.repository';
// eslint-disable-next-line no-restricted-imports -- El test arma el repositorio con sus colaboradores reales.
import { PrismaLedgerWriteRepository } from '../../packages/finance/src/ledger/infrastructure/prisma-ledger-write.repository';

const connectionString = process.env.TEST_DATABASE_URL;
if (
  !connectionString ||
  !['localhost', '127.0.0.1', '[::1]'].includes(
    new URL(connectionString).hostname,
  )
) {
  throw new Error(
    'Ledger concurrency integration requires a migrated local TEST_DATABASE_URL',
  );
}

const pool = new Pool({ connectionString, max: 4 });
const PrismaClient = getPrismaClientClass();
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const events = {
  enqueue: jest.fn().mockResolvedValue({}),
} as unknown as DomainEventPublisher;
const journal = {
  record: jest.fn().mockResolvedValue({ id: 'journal-1' }),
  restore: jest.fn(),
} as never;
const ledger = new PrismaLedgerRepository(
  prisma as never,
  new PrismaLedgerReadRepository(prisma as never),
  events,
  new PrismaLedgerDeletionRepository(prisma as never, events, journal),
  new PrismaLedgerImportRepository(prisma as never, events),
  new PrismaLedgerWriteRepository(prisma as never, events),
);
const userId = randomUUID();
let accountId: string;

beforeAll(async () => {
  await prisma.user.create({
    data: {
      id: userId,
      email: `${userId}@ledger-concurrency.test`,
      fullName: 'Ledger concurrency integration test',
    },
  });
  const institution = await prisma.finInstitution.create({
    data: { userId, name: 'Efectivo', type: 'cash' },
  });
  const account = await prisma.finAccount.create({
    data: {
      userId,
      institutionId: institution.id,
      name: 'Cuenta de concurrencia',
      type: 'CASH',
      currency: 'DOP',
      balance: 100,
    },
  });
  accountId = account.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
  await pool.end();
});

it('aplica el saldo una sola vez cuando dos confirmaciones compiten', async () => {
  const transaction = await prisma.finTransaction.create({
    data: {
      userId,
      accountId,
      type: 'DEBIT',
      amount: 50,
      ledgerAmount: 50,
      amountBaseCurrency: 50,
      currency: 'DOP',
      ledgerCurrency: 'DOP',
      exchangeRate: 1,
      description: 'Compra concurrente',
      transactionDate: new Date('2026-11-05T00:00:00.000Z'),
      status: 'PENDING',
      source: 'MANUAL',
    },
  });

  const outcomes = await Promise.all([
    ledger.confirmTransaction(userId, transaction.id),
    ledger.confirmTransaction(userId, transaction.id),
  ]);

  const [storedTransaction, storedAccount] = await Promise.all([
    prisma.finTransaction.findUnique({ where: { id: transaction.id } }),
    prisma.finAccount.findUnique({ where: { id: accountId } }),
  ]);

  expect(outcomes.every((outcome) => outcome !== null)).toBe(true);
  expect(storedTransaction?.status).toBe('CONFIRMED');
  expect(storedAccount?.balance.toString()).toBe('50');
});
