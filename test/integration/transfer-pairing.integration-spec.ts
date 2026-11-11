import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  getPrismaClientClass,
  type PrismaService,
} from '@personal-os/database';
import { FinanceSignalConsumer } from '@personal-os/finance';
import type { RoutedSignal } from '@personal-os/contracts';
// eslint-disable-next-line no-restricted-imports -- El test ejercita el repositorio real contra la base.
import { PrismaLedgerImportRepository } from '../../packages/finance/src/ledger/infrastructure/prisma-ledger-import.repository';

const connectionString = process.env.TEST_DATABASE_URL;
if (
  !connectionString ||
  !['localhost', '127.0.0.1', '[::1]'].includes(
    new URL(connectionString).hostname,
  )
) {
  throw new Error(
    'test:integration requires a migrated local TEST_DATABASE_URL',
  );
}

const pool = new Pool({ connectionString });
const PrismaClient = getPrismaClientClass();
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const events = { enqueue: () => Promise.resolve() };
const repo = new PrismaLedgerImportRepository(
  prisma as PrismaService,
  events as never,
);

const createdUserIds = new Set<string>();

async function createFixture({ suffix }: { suffix: string }) {
  const userId = randomUUID();
  createdUserIds.add(userId);
  await prisma.user.create({
    data: {
      id: userId,
      email: `${userId}@transfer-pairing.integration.test`,
      fullName: `Fixture emparejamiento #334 ${suffix}`,
    },
  });
  const institution = await prisma.finInstitution.create({
    data: { userId, name: `Banco ${suffix}`, type: 'bank' },
    select: { id: true },
  });
  const counterpartInstitution = await prisma.finInstitution.create({
    data: { userId, name: `Banco contraparte ${suffix}`, type: 'bank' },
    select: { id: true },
  });
  const account = await prisma.finAccount.create({
    data: {
      userId,
      institutionId: institution.id,
      name: `Cuenta ${suffix}`,
      type: 'SAVINGS',
      currency: 'DOP',
      accountNumberLast4: '1234',
    },
    select: { id: true },
  });
  const counterpartAccount = await prisma.finAccount.create({
    data: {
      userId,
      institutionId: counterpartInstitution.id,
      name: `Cuenta contraparte ${suffix}`,
      type: 'SAVINGS',
      currency: 'DOP',
      accountNumberLast4: '5678',
    },
    select: { id: true },
  });
  return {
    userId,
    institutionId: institution.id,
    counterpartInstitutionId: counterpartInstitution.id,
    accountId: account.id,
    counterpartAccountId: counterpartAccount.id,
  };
}

async function createLeg({
  userId,
  institutionId,
  accountId,
  type,
  legRole,
  daysAgo,
  externalReference,
  transferGroupId,
  importReference,
}: {
  userId: string;
  institutionId: string;
  accountId: string;
  type: 'DEBIT' | 'CREDIT';
  legRole: 'SOURCE' | 'DESTINATION';
  daysAgo: number;
  externalReference: string;
  transferGroupId?: string;
  importReference?: string;
}) {
  const id = randomUUID();
  await prisma.finTransaction.create({
    data: {
      id,
      userId,
      accountId,
      institutionId,
      type,
      amount: 1000,
      ledgerAmount: 1000,
      amountBaseCurrency: 1000,
      currency: 'DOP',
      ledgerCurrency: 'DOP',
      exchangeRate: 1,
      description: 'Transferencia sintética #334',
      source: 'EMAIL',
      status: 'CONFIRMED',
      legRole,
      transferGroupId: transferGroupId ?? randomUUID(),
      externalReference,
      importReference: importReference ?? `import-${id}`,
      transactionDate: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
      aiMetadata: {
        movementClass: type === 'DEBIT' ? 'TRANSFER_OUT' : 'TRANSFER_IN',
      },
    },
    select: { id: true },
  });
  return id;
}

function createConsumer() {
  const ledger = {
    findTransactionByImportReference: (
      importReference: string,
      userId: string,
    ) =>
      prisma.finTransaction.findFirst({ where: { importReference, userId } }),
  };
  const importTransaction = {
    executeUnpairedTransfer: (
      userId: string,
      input: Record<string, unknown> & { amount: number; currency: string },
    ) =>
      repo.createImportedTransaction(userId, {
        ...input,
        transferGroupId: randomUUID(),
        legRole: input.legRole === 'DESTINATION' ? 'DESTINATION' : 'SOURCE',
        amounts: {
          amount: input.amount,
          currency: input.currency,
          ledgerAmount: input.amount,
          ledgerCurrency: input.currency,
          amountBaseCurrency: input.amount,
          exchangeRate: 1,
        },
      } as never),
    pairTransferLegs: (userId: string, debitId: string, creditId: string) =>
      repo.pairImportedTransferLegs(userId, debitId, creditId),
  };
  return new FinanceSignalConsumer(
    prisma as never,
    importTransaction as never,
    ledger as never,
    { execute: jest.fn() } as never,
    { execute: jest.fn() } as never,
    { suggest: jest.fn() } as never,
    { execute: jest.fn().mockResolvedValue('DOP') } as never,
  );
}

function transferSignal({
  userId,
  signalId,
}: {
  userId: string;
  signalId: string;
}): RoutedSignal {
  return {
    signalId,
    userId,
    signalType: 'FINANCE.TRANSACTION_DETECTED',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    sourceType: 'EMAIL_MESSAGE',
    sourceId: `message-${signalId}`,
    payload: {
      relevance: true,
      semanticType: 'FIN_TRANSACTION',
      routes: ['FINANCE'],
      confidence: 0.95,
      transaction: {
        kind: 'TRANSACTION',
        amount: 1000,
        currency: 'DOP',
        transactionDate: new Date().toISOString(),
        direction: 'DEBIT',
        movementClass: 'TRANSFER_OUT',
        accountNumberLast4: '1234',
        bankReference: 'REF-C',
        bankStatusNormalized: 'COMPLETED',
        statusConfidence: 0.95,
      },
    },
  };
}

describe('Emparejamiento de patas de transferencia', () => {
  afterAll(async () => {
    const userIds = [...createdUserIds];
    if (userIds.length) {
      await prisma.finTransaction.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.finAccount.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.finInstitution.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
    await pool.end();
  });

  it('vincula las dos patas en un solo grupo sin categoria ni gasto', async () => {
    const fixture = await createFixture({ suffix: 'patas' });
    const other = await createFixture({ suffix: 'ajeno' });
    const debitId = await createLeg({
      userId: fixture.userId,
      institutionId: fixture.institutionId,
      accountId: fixture.accountId,
      type: 'DEBIT',
      legRole: 'SOURCE',
      daysAgo: 5,
      externalReference: 'REF-334',
    });
    const creditId = await createLeg({
      userId: fixture.userId,
      institutionId: fixture.counterpartInstitutionId,
      accountId: fixture.accountId,
      type: 'CREDIT',
      legRole: 'DESTINATION',
      daysAgo: 0,
      externalReference: 'REF-334',
    });
    const otherLegId = await createLeg({
      userId: other.userId,
      institutionId: other.institutionId,
      accountId: other.accountId,
      type: 'CREDIT',
      legRole: 'DESTINATION',
      daysAgo: 0,
      externalReference: 'REF-334',
    });

    const paired = await repo.pairImportedTransferLegs(
      fixture.userId,
      debitId,
      creditId,
    );

    expect(paired).not.toBeNull();
    const legs = await prisma.finTransaction.findMany({
      where: { id: { in: [debitId, creditId] } },
      select: {
        id: true,
        transferGroupId: true,
        categoryId: true,
        type: true,
      },
    });
    expect(legs).toHaveLength(2);
    expect(new Set(legs.map((leg) => leg.transferGroupId)).size).toBe(1);
    expect(legs.every((leg) => leg.categoryId === null)).toBe(true);
    expect(legs.map((leg) => leg.type).sort()).toEqual(['CREDIT', 'DEBIT']);

    const untouched = await prisma.finTransaction.findUniqueOrThrow({
      where: { id: otherLegId },
      select: { transferGroupId: true },
    });
    expect(untouched.transferGroupId).not.toBe(legs[0].transferGroupId ?? '');
  });

  it('repara una pata sin par cuando la señal se repite', async () => {
    const fixture = await createFixture({ suffix: 'consumer-repair' });
    const signalId = `signal-${randomUUID()}`;
    const debitId = await createLeg({
      userId: fixture.userId,
      institutionId: fixture.institutionId,
      accountId: fixture.accountId,
      type: 'DEBIT',
      legRole: 'SOURCE',
      daysAgo: 0,
      externalReference: 'REF-C',
      importReference: signalId,
    });
    const creditId = await createLeg({
      userId: fixture.userId,
      institutionId: fixture.counterpartInstitutionId,
      accountId: fixture.counterpartAccountId,
      type: 'CREDIT',
      legRole: 'DESTINATION',
      daysAgo: 2,
      externalReference: 'REF-B',
    });
    const consumer = createConsumer();

    const consumeResult = await consumer.consume(
      transferSignal({ userId: fixture.userId, signalId }),
    );
    expect(consumeResult.outcome).toBe('ALREADY_APPLIED');

    const legs = await prisma.finTransaction.findMany({
      where: { id: { in: [debitId, creditId] } },
      select: { transferGroupId: true },
    });
    expect(legs).toHaveLength(2);
    expect(new Set(legs.map((leg) => leg.transferGroupId)).size).toBe(1);
  });

  it('no parte un par cuando el compañero queda fuera de la ventana', async () => {
    const fixture = await createFixture({ suffix: 'consumer-group' });
    const pairedGroup = randomUUID();
    const debitId = await createLeg({
      userId: fixture.userId,
      institutionId: fixture.institutionId,
      accountId: fixture.accountId,
      type: 'DEBIT',
      legRole: 'SOURCE',
      daysAgo: 9,
      externalReference: 'REF-B',
      transferGroupId: pairedGroup,
    });
    const creditId = await createLeg({
      userId: fixture.userId,
      institutionId: fixture.counterpartInstitutionId,
      accountId: fixture.counterpartAccountId,
      type: 'CREDIT',
      legRole: 'DESTINATION',
      daysAgo: 2,
      externalReference: 'REF-B',
      transferGroupId: pairedGroup,
    });
    const signalId = `signal-${randomUUID()}`;
    const consumer = createConsumer();

    const consumeResult = await consumer.consume(
      transferSignal({ userId: fixture.userId, signalId }),
    );
    expect(consumeResult.outcome).toBe('APPLIED');

    const current = await prisma.finTransaction.findFirstOrThrow({
      where: { userId: fixture.userId, importReference: signalId },
      select: { transferGroupId: true },
    });
    expect(current.transferGroupId).not.toBe(pairedGroup);
    const paired = await prisma.finTransaction.findMany({
      where: { id: { in: [debitId, creditId] } },
      select: { transferGroupId: true },
    });
    expect(paired.every((leg) => leg.transferGroupId === pairedGroup)).toBe(
      true,
    );
  });
});
