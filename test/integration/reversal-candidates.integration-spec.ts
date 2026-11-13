import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { getPrismaClientClass } from '@personal-os/database';
// eslint-disable-next-line no-restricted-imports -- El test ejercita el repositorio real contra la base.
import { PrismaLedgerReadRepository } from '../../packages/finance/src/ledger/infrastructure/prisma-ledger-read.repository';

const connectionString = process.env.TEST_DATABASE_URL;
if (
  !connectionString ||
  !['localhost', '127.0.0.1', '[::1]'].includes(
    new URL(connectionString).hostname,
  )
) {
  throw new Error(
    'Reversal candidates integration requires a migrated local TEST_DATABASE_URL',
  );
}

const pool = new Pool({ connectionString });
const PrismaClient = getPrismaClientClass();
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const repository = new PrismaLedgerReadRepository(prisma as never);

const userId = randomUUID();
const reversalDate = new Date('2026-11-06T19:24:00.000Z');
const windowFrom = new Date('2026-11-03T19:24:00.000Z');
let cardId: string;
let accountId: string;
let otherAccountId: string;
let otherCardId: string;
const expectedIds: string[] = [];

function purchase({
  date,
  card,
  account,
  amount = 138.79,
  currency = 'DOP',
  type = 'DEBIT',
  status = 'CONFIRMED',
}: {
  date: Date;
  card: string;
  account: string | null;
  amount?: number;
  currency?: string;
  type?: 'DEBIT' | 'CREDIT';
  status?: 'CONFIRMED' | 'PENDING';
}) {
  return prisma.finTransaction.create({
    data: {
      userId,
      accountId: account,
      cardId: card,
      type,
      amount,
      ledgerAmount: amount,
      amountBaseCurrency: amount,
      currency,
      ledgerCurrency: currency,
      exchangeRate: 1,
      merchant: 'Tienda',
      description: 'Compra de la tarjeta',
      transactionDate: date,
      status,
    },
    select: { id: true },
  });
}

beforeAll(async () => {
  await prisma.user.create({
    data: {
      id: userId,
      email: `${userId}@reversal-candidates.integration.test`,
      fullName: 'Reversal candidates integration test',
    },
  });
  const institution = await prisma.finInstitution.create({
    data: { userId, name: 'Banco de prueba', type: 'bank' },
    select: { id: true },
  });
  const account = await prisma.finAccount.create({
    data: {
      userId,
      institutionId: institution.id,
      name: 'Cuenta de la tarjeta',
      type: 'SAVINGS',
      currency: 'DOP',
      balance: 0,
      accountNumberLast4: '0016',
    },
    select: { id: true },
  });
  accountId = account.id;
  const otherAccount = await prisma.finAccount.create({
    data: {
      userId,
      institutionId: institution.id,
      name: 'Otra cuenta',
      type: 'SAVINGS',
      currency: 'DOP',
      balance: 0,
      accountNumberLast4: '0024',
    },
    select: { id: true },
  });
  otherAccountId = otherAccount.id;
  const card = await prisma.finCard.create({
    data: {
      userId,
      institutionId: institution.id,
      accountId,
      name: 'Tarjeta del piloto',
      type: 'CREDIT',
      lastFour: '6506',
    },
    select: { id: true },
  });
  cardId = card.id;
  const otherCard = await prisma.finCard.create({
    data: {
      userId,
      institutionId: institution.id,
      name: 'Otra tarjeta',
      type: 'CREDIT',
      lastFour: '1111',
    },
    select: { id: true },
  });
  otherCardId = otherCard.id;

  const insideWithoutAccount = await purchase({
    date: new Date('2026-11-06T19:23:00.000Z'),
    card: cardId,
    account: null,
  });
  expectedIds.push(insideWithoutAccount.id);
  const insideWithAccount = await purchase({
    date: new Date('2026-11-05T10:00:00.000Z'),
    card: cardId,
    account: accountId,
  });
  expectedIds.push(insideWithAccount.id);
  await purchase({
    date: new Date('2026-11-02T19:23:00.000Z'),
    card: cardId,
    account: null,
  });
  await purchase({
    date: new Date('2026-11-06T19:23:00.000Z'),
    card: cardId,
    account: otherAccountId,
  });
  await purchase({
    date: new Date('2026-11-06T19:23:00.000Z'),
    card: otherCardId,
    account: null,
  });
  await purchase({
    date: new Date('2026-11-06T19:23:00.000Z'),
    card: cardId,
    account: null,
    amount: 10,
  });
  await purchase({
    date: new Date('2026-11-06T19:23:00.000Z'),
    card: cardId,
    account: null,
    status: 'PENDING',
  });
  await purchase({
    date: new Date('2026-11-06T19:23:00.000Z'),
    card: cardId,
    account: null,
    type: 'CREDIT',
  });
});

afterAll(async () => {
  await prisma.finTransaction.deleteMany({ where: { userId } });
  await prisma.finCard.deleteMany({ where: { userId } });
  await prisma.finAccount.deleteMany({ where: { userId } });
  await prisma.finInstitution.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
  await pool.end();
});

describe('Card reversal candidates', () => {
  it('returns only the confirmed purchases on the card and account in the window', async () => {
    const candidates = await repository.findReverseCandidatesByCard(userId, {
      amount: 138.79,
      currency: 'DOP',
      cardId,
      accountId,
      from: windowFrom,
      to: reversalDate,
      statuses: ['CONFIRMED'],
    });

    expect(candidates.map(({ id }) => id).sort()).toEqual(
      [...expectedIds].sort(),
    );
  });
});
