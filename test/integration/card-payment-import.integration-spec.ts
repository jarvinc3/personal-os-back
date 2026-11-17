import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  getPrismaClientClass,
  type PrismaService,
} from '@personal-os/database';
// eslint-disable-next-line no-restricted-imports -- El test ejercita el repositorio real contra la base.
import { PrismaLedgerWriteRepository } from '../../packages/finance/src/ledger/infrastructure/prisma-ledger-write.repository';

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
const repo = new PrismaLedgerWriteRepository(prisma as PrismaService, events);

const createdUserIds = new Set<string>();

const amounts = {
  amount: 2500,
  currency: 'DOP',
  ledgerAmount: 2500,
  ledgerCurrency: 'DOP',
  amountBaseCurrency: 2500,
  exchangeRate: 1,
};

async function createFixture({ suffix }: { suffix: string }) {
  const userId = randomUUID();
  createdUserIds.add(userId);
  await prisma.user.create({
    data: {
      id: userId,
      email: `${userId}@card-payment.integration.test`,
      fullName: `Fixture pago de tarjeta #335 ${suffix}`,
    },
  });
  const institution = await prisma.finInstitution.create({
    data: { userId, name: `Banco ${suffix}`, type: 'bank' },
    select: { id: true },
  });
  const account = await prisma.finAccount.create({
    data: {
      userId,
      institutionId: institution.id,
      name: `Cuenta ${suffix}`,
      type: 'SAVINGS',
      currency: 'DOP',
      balance: 10_000,
      accountNumberLast4: '1234',
    },
    select: { id: true },
  });
  const card = await prisma.finCard.create({
    data: {
      userId,
      institutionId: institution.id,
      name: `Tarjeta ${suffix}`,
      type: 'CREDIT',
      lastFour: '4821',
      balances: { create: { currency: 'DOP', balance: 0 } },
    },
    select: { id: true },
  });
  return { userId, accountId: account.id, cardId: card.id };
}

describe('Pago de tarjeta importado de dos patas', () => {
  afterAll(async () => {
    const userIds = [...createdUserIds];
    if (userIds.length) {
      await prisma.finCard.deleteMany({ where: { userId: { in: userIds } } });
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

  it('crea dos patas, baja la cuenta, sube la tarjeta y no crea gasto', async () => {
    const fixture = await createFixture({ suffix: 'importado' });
    const other = await createFixture({ suffix: 'ajeno' });

    const created = await repo.createCardPayment({
      userId: fixture.userId,
      command: {
        fromAccountId: fixture.accountId,
        cardId: fixture.cardId,
        amount: 2500,
        currency: 'DOP',
        transactionDate: '2031-06-01T00:00:00.000Z',
        description: 'Pago de tarjeta',
        status: 'CONFIRMED',
        source: 'EMAIL',
        externalReference: 'PAY-335',
        importReference: 'email-message-335',
        aiMetadata: {
          signalId: 'email-message-335',
          movementClass: 'CARD_PAYMENT',
        },
      },
      fromAmounts: amounts,
      toAmounts: amounts,
    });

    expect(created).not.toBeNull();
    const legs = await prisma.finTransaction.findMany({
      where: { userId: fixture.userId, type: 'CARD_PAYMENT' },
      orderBy: { legRole: 'asc' },
    });
    expect(legs).toHaveLength(2);
    expect(new Set(legs.map((leg) => leg.transferGroupId)).size).toBe(1);
    expect(legs.map((leg) => leg.source)).toEqual(['EMAIL', 'EMAIL']);
    expect(legs.map((leg) => leg.legRole).sort()).toEqual([
      'DESTINATION',
      'SOURCE',
    ]);
    expect(legs.map((leg) => leg.categoryId)).toEqual([null, null]);

    const source = legs.find((leg) => leg.legRole === 'SOURCE');
    const destination = legs.find((leg) => leg.legRole === 'DESTINATION');
    expect(source).toMatchObject({
      accountId: fixture.accountId,
      cardId: null,
      importReference: 'email-message-335',
      externalReference: 'PAY-335',
    });
    expect(destination).toMatchObject({
      accountId: null,
      cardId: fixture.cardId,
      importReference: null,
      externalReference: 'PAY-335',
    });

    const account = await prisma.finAccount.findUniqueOrThrow({
      where: { id: fixture.accountId },
      select: { balance: true },
    });
    expect(account.balance.toString()).toBe('7500');

    const cardBalance = await prisma.finCardBalance.findFirstOrThrow({
      where: { cardId: fixture.cardId, currency: 'DOP' },
      select: { balance: true },
    });
    expect(cardBalance.balance.toString()).toBe('2500');

    await expect(
      prisma.finTransaction.count({ where: { userId: other.userId } }),
    ).resolves.toBe(0);
    const otherAccount = await prisma.finAccount.findUniqueOrThrow({
      where: { id: other.accountId },
      select: { balance: true },
    });
    expect(otherAccount.balance.toString()).toBe('10000');
  });

  it('crea un solo pago cuando dos correos iguales llegan a la vez', async () => {
    const fixture = await createFixture({ suffix: 'carrera' });
    const command = (importReference: string) => ({
      fromAccountId: fixture.accountId,
      cardId: fixture.cardId,
      amount: 2500,
      currency: 'DOP',
      transactionDate: '2031-06-02T00:00:00.000Z',
      description: 'Pago de tarjeta',
      status: 'CONFIRMED' as const,
      source: 'EMAIL' as const,
      externalReference: 'PAY-RACE',
      importReference,
      aiMetadata: { signalId: importReference },
    });
    const incoming = {
      accountId: fixture.accountId,
      cardId: fixture.cardId,
      amount: 2500,
      currency: 'DOP',
      transactionDate: new Date('2031-06-02T00:00:00.000Z'),
      bankReference: 'PAY-RACE',
    };

    const [first, second] = await Promise.all([
      repo.createImportedCardPayment({
        userId: fixture.userId,
        command: command('email-race-a'),
        fromAmounts: amounts,
        toAmounts: amounts,
        incoming,
      }),
      repo.createImportedCardPayment({
        userId: fixture.userId,
        command: command('email-race-b'),
        fromAmounts: amounts,
        toAmounts: amounts,
        incoming,
      }),
    ]);

    expect([first.kind, second.kind].sort()).toEqual(['created', 'duplicate']);
    await expect(
      prisma.finTransaction.count({
        where: { userId: fixture.userId, type: 'CARD_PAYMENT' },
      }),
    ).resolves.toBe(2);
    const account = await prisma.finAccount.findUniqueOrThrow({
      where: { id: fixture.accountId },
      select: { balance: true },
    });
    expect(account.balance.toString()).toBe('7500');
  });
});
