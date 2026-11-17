import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import type { DomainEventPublisher } from '@personal-os/contracts';
import { getPrismaClientClass } from '@personal-os/database';
// eslint-disable-next-line no-restricted-imports -- El test ejercita el repositorio real contra la base.
import { PrismaLedgerImportRepository } from '../../packages/finance/src/ledger/infrastructure/prisma-ledger-import.repository';
// eslint-disable-next-line no-restricted-imports -- El test verifica el error del tope atómico.
import {
  PartialReversalAlreadyAppliedError,
  PartialReversalExceedsOriginalError,
} from '../../packages/finance/src/ledger/application/partial-reversal.errors';

const connectionString = process.env.TEST_DATABASE_URL;
if (
  !connectionString ||
  !['localhost', '127.0.0.1', '[::1]'].includes(
    new URL(connectionString).hostname,
  )
) {
  throw new Error(
    'Partial reversal integration requires a migrated local TEST_DATABASE_URL',
  );
}

const pool = new Pool({ connectionString });
const PrismaClient = getPrismaClientClass();
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const events = {
  enqueue: jest.fn().mockResolvedValue({}),
} as unknown as DomainEventPublisher;
const repo = new PrismaLedgerImportRepository(prisma as never, events);
const userId = randomUUID();
let accountId: string;

beforeAll(async () => {
  await prisma.user.create({
    data: {
      id: userId,
      email: `${userId}@integration.test`,
      fullName: 'Partial reversal integration test',
    },
  });
  const institution = await prisma.finInstitution.create({
    data: { userId, name: 'Efectivo', type: 'cash' },
  });
  const account = await prisma.finAccount.create({
    data: {
      userId,
      institutionId: institution.id,
      name: 'Cuenta de reversos',
      type: 'CASH',
      currency: 'DOP',
      balance: 1000,
    },
  });
  accountId = account.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
  await pool.end();
});

function partialReversalCommand({
  originalId,
  amount,
  signalId,
  sourceEmailMessageId,
}: {
  originalId: string;
  amount: number;
  signalId: string;
  sourceEmailMessageId: string;
}) {
  return {
    accountId,
    importReference: signalId,
    externalReference: `reversal-${signalId}`,
    amount,
    currency: 'DOP',
    merchant: 'Tienda',
    description: 'Reverso parcial',
    transactionDate: new Date('2026-11-05T00:00:00.000Z'),
    type: 'CREDIT' as const,
    status: 'CONFIRMED' as const,
    categoryId: null,
    linkedTransactionId: originalId,
    sourceEmailMessageId,
    aiMetadata: { reversalSourceEmailMessageId: sourceEmailMessageId },
    amounts: {
      amount,
      currency: 'DOP',
      ledgerAmount: amount,
      ledgerCurrency: 'DOP',
      amountBaseCurrency: amount,
      exchangeRate: 1,
    },
  };
}

async function createOriginal(amount: number) {
  return prisma.finTransaction.create({
    data: {
      userId,
      accountId,
      type: 'DEBIT',
      amount,
      ledgerAmount: amount,
      amountBaseCurrency: amount,
      currency: 'DOP',
      ledgerCurrency: 'DOP',
      exchangeRate: 1,
      merchant: 'Tienda',
      description: 'Compra original',
      transactionDate: new Date('2026-11-01T00:00:00.000Z'),
      status: 'CONFIRMED',
      source: 'EMAIL',
      importReference: `original-${randomUUID()}`,
      externalReference: `original-ref-${randomUUID()}`,
    },
  });
}

async function linkedCredits(originalId: string) {
  return prisma.finTransaction.findMany({
    where: { userId, linkedTransactionId: originalId, type: 'CREDIT' },
    select: { amount: true },
  });
}

describe('partial reversal integrity on PostgreSQL', () => {
  it('links two distinct refunds with the same amount from different emails', async () => {
    const original = await createOriginal(100);

    await repo.createImportedTransaction(
      userId,
      partialReversalCommand({
        originalId: original.id,
        amount: 25,
        signalId: 'signal-distinct-a',
        sourceEmailMessageId: 'email-distinct-a',
      }),
    );
    await repo.createImportedTransaction(
      userId,
      partialReversalCommand({
        originalId: original.id,
        amount: 25,
        signalId: 'signal-distinct-b',
        sourceEmailMessageId: 'email-distinct-b',
      }),
    );

    const credits = await linkedCredits(original.id);
    expect(credits).toHaveLength(2);
    expect(
      credits.reduce((total, credit) => total + Number(credit.amount), 0),
    ).toBe(50);
  });

  it('links partials whose decimal sum reaches the purchase exactly', async () => {
    const original = await createOriginal(0.3);

    await repo.createImportedTransaction(
      userId,
      partialReversalCommand({
        originalId: original.id,
        amount: 0.1,
        signalId: 'signal-decimal-a',
        sourceEmailMessageId: 'email-decimal-a',
      }),
    );
    await repo.createImportedTransaction(
      userId,
      partialReversalCommand({
        originalId: original.id,
        amount: 0.2,
        signalId: 'signal-decimal-b',
        sourceEmailMessageId: 'email-decimal-b',
      }),
    );

    const credits = await linkedCredits(original.id);
    expect(credits).toHaveLength(2);
    expect(credits.map(({ amount }) => amount.toString()).sort()).toEqual([
      '0.1',
      '0.2',
    ]);
  });

  it('treats a replay from the same source email as already applied', async () => {
    const original = await createOriginal(100);

    await repo.createImportedTransaction(
      userId,
      partialReversalCommand({
        originalId: original.id,
        amount: 25,
        signalId: 'signal-replay-a',
        sourceEmailMessageId: 'email-replay-a',
      }),
    );

    await expect(
      repo.createImportedTransaction(
        userId,
        partialReversalCommand({
          originalId: original.id,
          amount: 25,
          signalId: 'signal-replay-b',
          sourceEmailMessageId: 'email-replay-a',
        }),
      ),
    ).rejects.toBeInstanceOf(PartialReversalAlreadyAppliedError);

    const credits = await linkedCredits(original.id);
    expect(credits).toHaveLength(1);
  });

  it('does not let concurrent partials exceed the original', async () => {
    const original = await createOriginal(100);

    const outcomes = await Promise.allSettled([
      repo.createImportedTransaction(
        userId,
        partialReversalCommand({
          originalId: original.id,
          amount: 70,
          signalId: 'signal-race-70',
          sourceEmailMessageId: 'email-race-70',
        }),
      ),
      repo.createImportedTransaction(
        userId,
        partialReversalCommand({
          originalId: original.id,
          amount: 60,
          signalId: 'signal-race-60',
          sourceEmailMessageId: 'email-race-60',
        }),
      ),
    ]);

    const fulfilled = outcomes.filter(
      (outcome) => outcome.status === 'fulfilled',
    );
    const rejected = outcomes.filter(
      (outcome) => outcome.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (rejected[0].status === 'rejected') {
      expect(rejected[0].reason).toBeInstanceOf(
        PartialReversalExceedsOriginalError,
      );
    }

    const credits = await linkedCredits(original.id);
    expect(credits).toHaveLength(1);
    expect(Number(credits[0].amount)).toBeLessThanOrEqual(100);
  });
});
