import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  getPrismaClientClass,
  type PrismaService,
} from '@personal-os/database';
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
  return {
    userId,
    institutionId: institution.id,
    counterpartInstitutionId: counterpartInstitution.id,
    accountId: account.id,
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
}: {
  userId: string;
  institutionId: string;
  accountId: string;
  type: 'DEBIT' | 'CREDIT';
  legRole: 'SOURCE' | 'DESTINATION';
  daysAgo: number;
  externalReference: string;
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
      transferGroupId: randomUUID(),
      externalReference,
      importReference: `import-${id}`,
      transactionDate: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
      aiMetadata: {
        movementClass: type === 'DEBIT' ? 'TRANSFER_OUT' : 'TRANSFER_IN',
      },
    },
    select: { id: true },
  });
  return id;
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
});
